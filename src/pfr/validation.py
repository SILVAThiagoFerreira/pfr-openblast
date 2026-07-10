from pathlib import Path

import pandas as pd

from .io import read_table
from .models import SourceFiles


def validate_columns(df, required: list[str], label: str) -> list[str]:
    missing = [col for col in required if col not in df.columns]
    return [f"{label} faltando colunas: {', '.join(missing)}"] if missing else []


def validate_sources(sources: SourceFiles, cfg: dict) -> None:
    errors: list[str] = []
    validation = cfg["validation"]

    for label, path in (("project", sources.project), ("final", sources.final)):
        if not path.exists():
            errors.append(f"Arquivo nao encontrado: {path.name}")

    if sources.project.exists():
        errors.extend(validate_columns(read_table(sources.project), validation["required_project_columns"], sources.project.name))
    if sources.final.exists():
        errors.extend(validate_columns(read_table(sources.final), validation["required_final_columns"], sources.final.name))

    if errors:
        raise ValueError("\n".join(errors))


def validate_output(data: pd.DataFrame, input_charges: pd.Series, cfg: dict) -> None:
    errors: list[str] = []
    validation = cfg.get("validation", {})
    charge_amplification_tolerance = float(validation.get("charge_amplification_tolerance", 0.02))
    total_deviation_tolerance = float(validation.get("total_deviation_tolerance", 0.02))
    max_charge_per_delay_kg = validation.get("max_charge_per_delay_kg")

    realized = pd.to_numeric(data["cargas realizadas"], errors="coerce")
    input_valid = pd.to_numeric(input_charges, errors="coerce").dropna()

    if input_valid.empty:
        return

    max_input_charge = float(input_valid.max())
    max_realized_charge = float(realized.max())
    if max_input_charge > 0:
        amplification = (max_realized_charge - max_input_charge) / max_input_charge
        if amplification > charge_amplification_tolerance:
            errors.append(
                f"Carga realizada maxima ({max_realized_charge:.2f} kg) excede "
                f"a carga prevista maxima ({max_input_charge:.2f} kg) em {amplification:.1%}. "
                f"Tolerancia: {charge_amplification_tolerance:.0%}"
            )

    input_total = float(input_valid.sum())
    realized_total = float(realized.sum())
    enforce_total = cfg.get("business", {}).get("enforce_charge_total_target", False)
    if not enforce_total and input_total > 0:
        deviation = abs(realized_total - input_total) / input_total
        if deviation > total_deviation_tolerance:
            errors.append(
                f"Carga total realizada ({realized_total:.2f} kg) difere do total "
                f"previsto ({input_total:.2f} kg) em {deviation:.1%}. "
                f"Tolerancia: {total_deviation_tolerance:.0%}"
            )

    if max_charge_per_delay_kg is not None:
        delay_groups = data.groupby("tempo detonacao (ms)")["cargas realizadas"].apply(
            lambda s: pd.to_numeric(s, errors="coerce").sum()
        )
        max_delay_charge = float(delay_groups.max())
        if max_delay_charge > float(max_charge_per_delay_kg):
            max_delay_ms = float(delay_groups.idxmax())
            errors.append(
                f"Carga maxima por espera ({max_delay_charge:.2f} kg no delay {max_delay_ms:.0f} ms) "
                f"excede o limite configurado ({max_charge_per_delay_kg} kg)."
            )

    if errors:
        raise ValueError("\n".join(errors))
