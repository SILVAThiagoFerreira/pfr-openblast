from __future__ import annotations

import logging
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

from .config import load_config, normalize_config
from .discovery import discover_sources
from .export import export_workbook
from .io import backup_inputs
from .models import RunResult
from .processing import build_output_frame, build_summary, extract_blast_datetime, extract_plan_id, load_final_frame, load_project_frame, merge_frames
from .validation import validate_output, validate_sources


def configure_logging(cfg: dict) -> logging.Logger:
    log_root = cfg["paths"]["log_root"]
    log_root.mkdir(parents=True, exist_ok=True)
    log_file = log_root / cfg["logging"]["file_template"].format(date=datetime.now().strftime("%Y%m%d"))
    handlers = [logging.FileHandler(log_file, encoding="utf-8")]
    if cfg["logging"].get("console", True):
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=getattr(logging, cfg["logging"].get("level", "INFO").upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )
    return logging.getLogger("pfr")


def run(config_path: Path) -> RunResult:
    root = Path(__file__).resolve().parents[2]
    raw = load_config(config_path)
    cfg = normalize_config(raw, root)
    logger = configure_logging(cfg)

    cfg["paths"]["output_root"].mkdir(parents=True, exist_ok=True)
    cfg["paths"]["backup_root"].mkdir(parents=True, exist_ok=True)

    sources = discover_sources(cfg)
    validate_sources(sources, cfg)
    backup_inputs([sources.project, sources.final, sources.plan_pdf, *sources.histo_files], cfg["paths"]["backup_root"])

    plan_id = extract_plan_id(sources.plan_pdf, sources.histo_files, cfg)
    blast_date, blast_time = extract_blast_datetime(sources.histo_files, plan_id)

    project = load_project_frame(sources.project)
    final = load_final_frame(sources.final)
    merged = merge_frames(project, final, cfg)
    data = build_output_frame(merged, plan_id, blast_date, blast_time, cfg)
    validate_output(data, merged["r_explosive"], cfg)
    if merged.attrs.get("imputed_detonating_time_count", 0):
        logger.info("Tempo detonacao imputado em %s furos", merged.attrs["imputed_detonating_time_count"])
    if merged.attrs.get("stemming_variation_count", 0):
        logger.info("Variação de tampao aplicada em %s furos", merged.attrs["stemming_variation_count"])
    if merged.attrs.get("charge_total_adjusted", False):
        logger.info("Carga total ajustada para %s kg preservando os extremos", cfg["business"].get("charge_total_target_kg"))
    summary = build_summary(merged, data, plan_id, blast_date, blast_time, {
        "project": sources.project,
        "final": sources.final,
        "plan_pdf": sources.plan_pdf,
    })

    output_name = cfg["business"]["output_name_template"].format(plan_id=plan_id)
    output_path = cfg["paths"]["output_root"] / output_name
    if output_path.exists():
        output_path = cfg["paths"]["output_root"] / f"{output_path.stem}_{datetime.now().strftime('%H%M%S')}{output_path.suffix}"
    export_workbook(output_path, data, summary, cfg)

    total_emulsion = float(pd.to_numeric(data["cargas realizadas"], errors="coerce").sum())
    delay_groups = data.groupby("tempo detonacao (ms)")["cargas realizadas"].apply(lambda s: pd.to_numeric(s, errors="coerce").sum())
    max_charge_per_delay = float(delay_groups.max())
    max_charge_delay_ms = float(delay_groups.idxmax())

    logger.info("Plano gerado: %s", output_path)
    logger.info("Total emulsao: %.2f kg | Carga max por espera: %.2f kg (delay %.0f ms)", total_emulsion, max_charge_per_delay, max_charge_delay_ms)
    return RunResult(
        output_path=output_path, plan_id=plan_id, blast_date=blast_date, blast_time=blast_time, rows=len(data),
        total_emulsion_kg=total_emulsion, max_charge_per_delay_kg=max_charge_per_delay, max_charge_delay_ms=max_charge_delay_ms,
    )
