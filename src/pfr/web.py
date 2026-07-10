from __future__ import annotations

import logging
import os
import shutil
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml
from flask import Flask, jsonify, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

from .config import load_config
from .pipeline import run

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xlsm", ".pdf", ".txt"}
MAX_FILE_SIZE = 250 * 1024 * 1024
MAX_FILES_PER_RUN = 20


def create_app(project_root: Path, default_config: Path) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE
    app.config["PROJECT_ROOT"] = project_root
    app.config["RUN_ROOT"] = Path(os.environ.get("PFR_DATA_DIR", project_root / "data" / "web_runs"))
    logger = logging.getLogger("pfr.web")

    @app.after_request
    def cors(response):
        response.headers["Access-Control-Allow-Origin"] = os.environ.get("PFR_ALLOWED_ORIGIN", "*")
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    @app.errorhandler(413)
    def request_too_large(_error):
        return jsonify({"error": "Os anexos excedem o limite total de 250 MB."}), 413

    @app.get("/")
    def index():
        return send_from_directory(project_root / "public", "index.html")

    @app.get("/<path:filename>")
    def public_file(filename: str):
        return send_from_directory(project_root / "public", filename)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "pfr-openblast"})

    @app.post("/api/generate")
    def generate():
        files = [item for item in request.files.getlist("inputs") if item and item.filename]
        if not files:
            return jsonify({"error": "Anexe os arquivos de projeto, config final, PP e HISTO."}), 400
        if len(files) > MAX_FILES_PER_RUN:
            return jsonify({"error": f"Envie no máximo {MAX_FILES_PER_RUN} arquivos por execução."}), 400

        _cleanup_expired_runs(app.config["RUN_ROOT"])

        run_id = uuid.uuid4().hex[:12]
        run_root = app.config["RUN_ROOT"] / run_id
        input_root = run_root / "input"
        output_root = run_root / "output"
        input_root.mkdir(parents=True, exist_ok=True)
        output_root.mkdir(parents=True, exist_ok=True)
        saved_files = []
        try:
            seen_names: set[str] = set()
            for upload in files:
                filename = _safe_filename(upload.filename)
                if not filename or Path(filename).suffix.lower() not in ALLOWED_EXTENSIONS:
                    raise ValueError(f"Extensão não permitida: {filename or upload.filename}")
                normalized = filename.casefold()
                if normalized in seen_names:
                    raise ValueError(f"Arquivo duplicado no envio: {filename}")
                seen_names.add(normalized)
                upload.save(input_root / filename)
                saved_files.append(filename)

            config_path = _build_run_config(default_config, project_root, input_root, output_root, run_root)
            result = run(config_path)
            return jsonify({
                "run_id": run_id,
                "plan_id": result.plan_id,
                "blast_date": result.blast_date,
                "blast_time": result.blast_time,
                "rows": result.rows,
                "total_emulsion_kg": result.total_emulsion_kg,
                "max_charge_per_delay_kg": result.max_charge_per_delay_kg,
                "max_charge_delay_ms": result.max_charge_delay_ms,
                "files": saved_files,
                "download_url": f"/api/download/{run_id}/{secure_filename(result.output_path.name)}",
            })
        except Exception as exc:  # noqa: BLE001 - validation errors must reach the user
            logger.exception("Falha na execução web %s", run_id)
            shutil.rmtree(run_root, ignore_errors=True)
            return jsonify({"error": str(exc), "run_id": run_id, "files": saved_files}), 400

    @app.get("/api/download/<run_id>/<filename>")
    def download(run_id: str, filename: str):
        safe_run_id = secure_filename(run_id)
        safe_filename = secure_filename(filename)
        root = (app.config["RUN_ROOT"] / safe_run_id / "output").resolve()
        target = (root / safe_filename).resolve()
        if root not in target.parents or not target.is_file():
            return jsonify({"error": "Arquivo não encontrado."}), 404
        return send_file(target, as_attachment=True, download_name=target.name)

    return app


def _safe_filename(filename: str) -> str:
    return Path(filename.replace("\\", "/")).name.strip()


def _cleanup_expired_runs(run_root: Path) -> None:
    if not run_root.exists():
        return
    age_hours = float(os.environ.get("PFR_RUN_RETENTION_HOURS", "24"))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=age_hours)
    for child in run_root.iterdir():
        if not child.is_dir():
            continue
        modified = datetime.fromtimestamp(child.stat().st_mtime, timezone.utc)
        if modified < cutoff:
            shutil.rmtree(child, ignore_errors=True)


def _build_run_config(default_config: Path, project_root: Path, input_root: Path, output_root: Path, run_root: Path) -> Path:
    cfg = deepcopy(load_config(default_config))
    cfg.setdefault("paths", {})
    cfg["paths"].update({
        "project_root": str(project_root),
        "input_root": str(input_root),
        "output_root": str(output_root),
        "backup_root": str(run_root / "backup"),
        "log_root": str(run_root / "logs"),
    })
    config_path = run_root / "config.yaml"
    config_path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return config_path
