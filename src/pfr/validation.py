import re
from pathlib import Path

import pandas as pd

from .io import read_table
from .models import SourceFiles


def parse_signature_hole_id(value) -> int | None:
    """`business.signature_hole_id`: vazio ou nulo = sem furo de assinatura; senão, o Number do furo (somente dígitos)."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if not re.fullmatch(r"\d+", text):
        raise ValueError(
            "O ID do furo de assinatura deve ser o número do furo, como aparece no Config Final (ex.: 245). "
            f"Valor configurado: \"{text}\"."
        )
    return int(text)


def validate_signature_hole(merged: pd.DataFrame, cfg: dict) -> pd.Series:
    """Máscara booleana (mesmo índice de `merged`) marcando o furo de assinatura. Regras em SPEC.md ("Furo de assinatura").

    Bloqueia com mensagem explícita: ID inválido, ID ausente do plano, ID repetido e tempo de detonação
    do furo que não pode ser preservado (vazio, negativo, não inteiro ou repetido em outro furo).
    """
    hole_id = parse_signature_hole_id(cfg.get("business", {}).get("signature_hole_id"))
    mask = pd.Series(False, index=merged.index, dtype=bool)
    if hole_id is None:
        return mask

    numbers = pd.to_numeric(merged["Number"], errors="coerce")
    positions = [position for position, value in enumerate(numbers.tolist()) if value == hole_id]
    if not positions:
        raise ValueError(
            f"O furo de assinatura {hole_id} não foi encontrado no plano realizado (Config Final). "
            "Confira o ID; um furo marcado como eliminated só entra no plano quando business.include_eliminated está ativo."
        )
    if len(positions) > 1:
        raise ValueError(f"O ID do furo de assinatura {hole_id} aparece mais de uma vez no Config Final.")

    position = positions[0]
    times = pd.to_numeric(merged["DetonatingTime"], errors="coerce") if "DetonatingTime" in merged.columns else pd.Series(float("nan"), index=merged.index)
    raw = float(times.iloc[position])
    time_message = (
        f"O furo de assinatura {hole_id} não tem tempo de detonação válido na entrada (vazio, negativo, não inteiro "
        "ou repetido em outro furo). Como o tempo deve ser preservado como veio da entrada, corrija o Config Final."
    )
    if pd.isna(raw) or raw < 0 or not raw.is_integer():
        raise ValueError(time_message)
    normalized = times.round(0).where(times >= 0)
    if int((normalized == raw).sum()) != 1:
        raise ValueError(time_message)

    mask.iloc[position] = True
    return mask


def validate_columns(df, required: list[str], label: str) -> list[str]:
    missing = [col for col in required if col not in df.columns]
    return [f"{label} faltando colunas: {', '.join(missing)}"] if missing else []


def check_design_columns(design, required: list[str], label: str) -> list[str]:
    """Plano de Perfuração sem colunas de cota não bloqueia: vira aviso e a cota não é lida dessa planilha."""
    missing = [col for col in required if col not in design.columns]
    if not missing:
        return []
    return [f"{label}: colunas {', '.join(missing)} não encontradas; a cota (Z) não foi lida desta planilha."]


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

    timing = pd.to_numeric(data["tempo detonacao (ms)"], errors="coerce")
    if timing.isna().any():
        errors.append("Tempo de detonacao ausente ou invalido em um ou mais furos.")
    if (timing < 0).any():
        errors.append("Tempo de detonacao negativo encontrado na saida.")
    if timing.dropna().duplicated().any():
        errors.append("Tempos de detonacao repetidos encontrados na saida; cada furo deve ter um tempo unico.")

    realized = pd.to_numeric(data["cargas realizadas"], errors="coerce")
    input_valid = pd.to_numeric(input_charges, errors="coerce").dropna()

    if not input_valid.empty:
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
