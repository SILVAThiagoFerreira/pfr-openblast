from __future__ import annotations

import re
import hashlib
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from pypdf import PdfReader

from .io import read_table, read_text


def _series_or_na(df: pd.DataFrame, column: str) -> pd.Series:
    if column in df.columns:
        return pd.to_numeric(df[column], errors="coerce")
    return pd.Series(np.nan, index=df.index)


def _unique_integer_sequence(lower: int | None, upper: int | None, count: int, forbidden: set[int]) -> list[int]:
    if count <= 0:
        return []

    if lower is not None and upper is not None:
        candidates = np.floor(np.linspace(lower, upper, count + 2)[1:-1]).astype(int).tolist()
        chosen: list[int] = []
        cursor = lower
        for idx, candidate in enumerate(candidates):
            value = int(candidate)
            if value <= cursor:
                value = cursor + 1
            while value in forbidden or value in chosen:
                value += 1
            cursor = value
            chosen.append(value)
        return chosen

    if upper is not None:
        candidates: list[int] = []
        value = upper - 1
        while len(candidates) < count and value > 0:
            if value not in forbidden:
                candidates.append(value)
            value -= 1
        if len(candidates) < count:
            raise ValueError("Nao foi possivel imputar tempos detonacao unicos antes do primeiro valor conhecido.")
        return list(reversed(candidates))

    if lower is not None:
        candidates: list[int] = []
        value = lower + 1
        while len(candidates) < count:
            if value not in forbidden:
                candidates.append(value)
            value += 1
        return candidates

    start = 1
    while any((start + offset) in forbidden for offset in range(count)):
        start += 1
    return list(range(start, start + count))


def _fill_missing_detonating_time(series: pd.Series, enabled: bool) -> tuple[pd.Series, int]:
    values = pd.to_numeric(series, errors="coerce")
    if not enabled:
        return values.round(0).astype("Int64"), 0

    result = values.round(0).astype("Int64").copy()
    forbidden = {int(value) for value in values.dropna().round(0).astype(int).tolist()}
    missing_positions = [idx for idx, value in enumerate(values.isna().tolist()) if value]
    imputed = 0

    if not missing_positions:
        return result, imputed

    start = 0
    while start < len(values):
        if not pd.isna(values.iloc[start]):
            start += 1
            continue

        end = start
        while end < len(values) and pd.isna(values.iloc[end]):
            end += 1

        left_value = None
        for left_idx in range(start - 1, -1, -1):
            if not pd.isna(values.iloc[left_idx]):
                left_value = int(round(float(values.iloc[left_idx])))
                break

        right_value = None
        for right_idx in range(end, len(values)):
            if not pd.isna(values.iloc[right_idx]):
                right_value = int(round(float(values.iloc[right_idx])))
                break

        block_count = end - start
        block_values = _unique_integer_sequence(left_value, right_value, block_count, forbidden)
        for offset, value in enumerate(block_values):
            result.iloc[start + offset] = value
            forbidden.add(int(value))
            imputed += 1

        start = end

    return result, imputed


def _apply_stemming_variation(values: pd.Series, numbers: pd.Series, plan_id: str, enabled: bool, max_delta: float) -> tuple[pd.Series, int]:
    base = pd.to_numeric(values, errors="coerce")
    if not enabled:
        return base, 0

    varied = base.copy()
    count = 0
    for idx, (number, value) in enumerate(zip(pd.to_numeric(numbers, errors="coerce"), base, strict=False)):
        if pd.isna(value) or pd.isna(number):
            continue
        seed = f"{plan_id}:{int(number)}:stemming"
        digest = hashlib.sha256(seed.encode("utf-8")).digest()
        magnitude = (int.from_bytes(digest[:4], "big") / 0xFFFFFFFF) * max_delta
        sign = 1 if digest[4] % 2 else -1
        adjusted = max(0.0, float(value) + (sign * magnitude))
        varied.iloc[idx] = round(adjusted, 2)
        count += 1
    return varied, count


def _redistribute_zero_charges(
    charges: pd.Series,
    enabled: bool,
    target_total: float | None,
    minimum_zero_charge: float,
) -> tuple[pd.Series, int]:
    values = pd.to_numeric(charges, errors="coerce").astype(float)
    if not enabled:
        return values, 0

    zero_mask = values.eq(0)
    zero_count = int(zero_mask.sum())
    if zero_count == 0:
        return values, 0

    if target_total is None:
        raise ValueError(
            "Foram encontrados furos com carga zerada. Defina business.charge_total_target_kg para redistribuir a carga sem alterar o total."
        )

    target_total = float(target_total)
    if target_total <= 0:
        raise ValueError("business.charge_total_target_kg deve ser maior que zero quando houver furos com carga zerada.")

    non_zero_mask = ~zero_mask & values.notna()
    if non_zero_mask.sum() < 3:
        raise ValueError("Nao ha furos suficientes para redistribuir a carga preservando o menor e o maior valor.")

    min_idx = values[non_zero_mask].idxmin()
    max_idx = values[non_zero_mask].idxmax()

    redistribution_targets = zero_mask.copy()
    redistribution_targets.loc[min_idx] = False
    redistribution_targets.loc[max_idx] = False

    adjustable_mask = non_zero_mask & ~values.index.isin([min_idx, max_idx])
    adjustable_total = float(values[adjustable_mask].sum())
    if adjustable_total <= 0:
        raise ValueError("Nao foi possivel redistribuir a carga sem alterar o menor e o maior valor.")

    zero_allocation = minimum_zero_charge * zero_count
    if zero_allocation <= 0:
        raise ValueError("business.charge_zero_fill_min_kg deve ser maior que zero quando houver furos com carga zerada.")

    if zero_allocation >= target_total:
        raise ValueError("A carga minima configurada para furos zerados excede o total alvo.")

    result = values.copy()
    result.loc[zero_mask] = minimum_zero_charge

    delta = zero_allocation
    if delta > adjustable_total:
        raise ValueError(
            "A redistribuicao solicitada excede a carga disponivel nos furos ajustaveis preservando os extremos."
        )

    adjustable_values = result[adjustable_mask]
    weights = adjustable_values / adjustable_values.sum()
    result.loc[adjustable_mask] = adjustable_values - (weights * delta)

    result = result.round(3)
    if (result < 0).any():
        raise ValueError("A redistribuicao gerou carga negativa em pelo menos um furo.")
    original_total = float(values.sum())
    current_total = float(result.sum())
    remainder = round(original_total - current_total, 3)
    if abs(remainder) > 0:
        correction_candidates = result[adjustable_mask].sort_values(ascending=False)
        if correction_candidates.empty:
            raise ValueError("Nao foi possivel aplicar a correção final da carga sem alterar os extremos.")
        correction_idx = correction_candidates.index[0]
        result.loc[correction_idx] = round(result.loc[correction_idx] + remainder, 3)

    if result.loc[min_idx] != values.loc[min_idx] or result.loc[max_idx] != values.loc[max_idx]:
        raise ValueError("A redistribuicao alterou indevidamente o menor ou o maior valor de carga.")

    return result, zero_count


def _rebalance_adjustable_values(
    values: pd.Series,
    delta: float,
    lower_bound: float,
    upper_bound: float,
) -> pd.Series:
    result = pd.to_numeric(values, errors="coerce").astype(float).copy()
    tolerance = 1e-9
    if abs(delta) <= tolerance:
        return result

    if delta > 0:
        remaining = float(delta)
        while remaining > tolerance:
            capacity = (upper_bound - result).clip(lower=0)
            candidates = capacity[capacity > tolerance]
            if candidates.empty:
                raise ValueError("Nao ha folga suficiente para elevar a carga total sem ultrapassar o maior valor preservado.")
            weights = result.loc[candidates.index].clip(lower=tolerance)
            if float(weights.sum()) <= tolerance:
                weights = pd.Series(1.0, index=candidates.index)
            weights = weights / float(weights.sum())
            proposal = weights * remaining
            applied = pd.concat([proposal, candidates], axis=1).min(axis=1)
            consumed = float(applied.sum())
            if consumed <= tolerance:
                raise ValueError("Nao foi possivel distribuir o acrescimo de carga dentro dos limites configurados.")
            result.loc[applied.index] = result.loc[applied.index] + applied
            remaining -= consumed
        return result

    remaining = float(-delta)
    while remaining > tolerance:
        capacity = (result - lower_bound).clip(lower=0)
        candidates = capacity[capacity > tolerance]
        if candidates.empty:
            raise ValueError("Nao ha carga suficiente para reduzir o total sem ultrapassar o menor valor preservado.")
        weights = result.loc[candidates.index].clip(lower=tolerance)
        if float(weights.sum()) <= tolerance:
            weights = candidates
        weights = weights / float(weights.sum())
        proposal = weights * remaining
        applied = pd.concat([proposal, candidates], axis=1).min(axis=1)
        consumed = float(applied.sum())
        if consumed <= tolerance:
            raise ValueError("Nao foi possivel distribuir a reducao de carga dentro dos limites configurados.")
        result.loc[applied.index] = result.loc[applied.index] - applied
        remaining -= consumed
    return result


def _enforce_charge_total_target(
    charges: pd.Series,
    enabled: bool,
    target_total: float | None,
) -> tuple[pd.Series, bool]:
    values = pd.to_numeric(charges, errors="coerce").astype(float)
    if not enabled or target_total is None:
        return values, False

    valid = values.dropna()
    if valid.empty:
        return values, False

    target_total = float(target_total)
    current_total = float(valid.sum())
    delta = round(target_total - current_total, 6)
    if abs(delta) < 0.0005:
        return values, False

    if len(valid) < 3:
        raise ValueError("Sao necessarios pelo menos 3 furos com carga valida para fechar o total preservando os extremos.")

    ordered = valid.sort_values(kind="mergesort")
    min_idx = ordered.index[0]
    max_idx = ordered.index[-1]
    if min_idx == max_idx:
        raise ValueError("Nao foi possivel identificar furos distintos para preservar o menor e o maior valor de carga.")

    lower_bound = float(ordered.iloc[0])
    upper_bound = float(ordered.iloc[-1])
    adjustable_mask = values.notna() & ~values.index.isin([min_idx, max_idx])
    adjustable = values.loc[adjustable_mask]
    if adjustable.empty:
        raise ValueError("Nao ha furos ajustaveis para fechar a carga total preservando os extremos.")

    adjusted = _rebalance_adjustable_values(adjustable, delta, lower_bound, upper_bound)
    result = values.copy()
    result.loc[adjustable.index] = adjusted
    result = result.round(3)

    if (result.loc[adjustable.index] < lower_bound - 0.001).any():
        raise ValueError("O fechamento da carga criou valor abaixo do menor limite preservado.")
    if (result.loc[adjustable.index] > upper_bound + 0.001).any():
        raise ValueError("O fechamento da carga criou valor acima do maior limite preservado.")

    current_total = float(result.dropna().sum())
    remainder = round(target_total - current_total, 3)
    if abs(remainder) > 0:
        if remainder > 0:
            candidates = result.loc[adjustable.index][result.loc[adjustable.index] < upper_bound - 0.001].sort_values(ascending=False)
        else:
            candidates = result.loc[adjustable.index][result.loc[adjustable.index] > lower_bound + 0.001].sort_values(ascending=False)
        if candidates.empty:
            raise ValueError("Nao foi possivel aplicar a correção final da carga preservando os extremos.")
        correction_idx = candidates.index[0]
        corrected_value = round(result.loc[correction_idx] + remainder, 3)
        if corrected_value < lower_bound - 0.001 or corrected_value > upper_bound + 0.001:
            raise ValueError("A correção final da carga violou os limites preservados.")
        result.loc[correction_idx] = corrected_value

    if round(float(result.loc[min_idx]), 3) != round(lower_bound, 3):
        raise ValueError("O fechamento da carga alterou o menor valor preservado.")
    if round(float(result.loc[max_idx]), 3) != round(upper_bound, 3):
        raise ValueError("O fechamento da carga alterou o maior valor preservado.")

    return result, True


def extract_plan_id(plan_pdf: Path | None, histo_files: tuple[Path, ...], cfg: dict) -> str:
    business = cfg.get("business", {})
    source = str(business.get("plan_id_source", "auto")).strip().lower()
    fallback = str(business.get("fallback_plan_id", "")).strip()
    if source == "fallback":
        if not fallback:
            raise ValueError("business.fallback_plan_id deve ser informado quando plan_id_source=fallback.")
        return fallback
    regex = re.compile(cfg["business"]["plan_id_regex"])
    if plan_pdf and plan_pdf.exists():
        text = " ".join(page.extract_text() or "" for page in PdfReader(str(plan_pdf)).pages)
        match = regex.search(text)
        if match:
            return match.group(1)
    for histo in histo_files:
        match = regex.search(read_text(histo))
        if match:
            return match.group(1)
    if fallback:
        return fallback
    raise ValueError("Não foi possível identificar o ID do plano nos anexos e não há fallback configurado.")


def _format_histo_datetime(date_str: str, time_str: str) -> tuple[str, str]:
    return datetime.strptime(date_str, "%Y/%m/%d").strftime("%d/%m/%Y"), time_str


_PLAN_ID_PATTERN = re.compile(r"\bPP(?:[\s._/-]*\d){6,8}(?:[_-][A-Z])?\b", re.IGNORECASE)


def _plan_id_signature(value: str) -> tuple[str, str] | None:
    digits = re.sub(r"[^0-9]", "", str(value))
    if not re.fullmatch(r"\d{6,8}", digits):
        return None
    month = digits[-4:-2]
    if not 1 <= int(month) <= 12:
        return None
    plan = digits[:-4].lstrip("0") or "0"
    return plan, digits[-2:]


def _plan_id_signature_with_month(value: str) -> tuple[str, str, str] | None:
    digits = re.sub(r"[^0-9]", "", str(value))
    if not re.fullmatch(r"\d{6,8}", digits):
        return None
    month = digits[-4:-2]
    if not 1 <= int(month) <= 12:
        return None
    plan = digits[:-4].lstrip("0") or "0"
    return plan, month, digits[-2:]


def _normalize_plan_id(value: str) -> str:
    digits = re.sub(r"[^0-9]", "", str(value))
    return digits.lstrip("0") or digits


def _plan_ids_match(left: str, right: str) -> bool:
    left_signature = _plan_id_signature(left)
    right_signature = _plan_id_signature(right)
    if left_signature and right_signature:
        return left_signature == right_signature
    return _normalize_plan_id(left) == _normalize_plan_id(right)


def _plan_ids_match_same_month(left: str, right: str) -> bool:
    left_signature = _plan_id_signature_with_month(left)
    right_signature = _plan_id_signature_with_month(right)
    return bool(left_signature and right_signature and left_signature == right_signature)


def extract_blast_datetime(
    histo_files: tuple[Path, ...],
    plan_id: str | None = None,
    allow_unmatched_plan_fallback: bool = False,
) -> tuple[str, str]:
    if plan_id:
        event_pattern = re.compile(r"\[(BlastingPlan|Fire)\](\d{4}/\d{2}/\d{2})-(\d{2}:\d{2}:\d{2})")
        matches: list[tuple[str, str, str, str, str]] = []
        for file in sorted(histo_files, key=lambda item: item.stat().st_mtime, reverse=True):
            text = read_text(file)
            events = list(event_pattern.finditer(text))
            for index, event in enumerate(events):
                if event.group(1) != "BlastingPlan":
                    continue
                next_event_start = events[index + 1].start() if index + 1 < len(events) else len(text)
                block = text[event.start():next_event_start]
                block_plan_ids = _PLAN_ID_PATTERN.findall(block)
                matching_plan_ids = [candidate for candidate in block_plan_ids if _plan_ids_match(plan_id, candidate)]
                if not matching_plan_ids:
                    continue
                for follow_event in events[index + 1:]:
                    if follow_event.group(1) == "Fire":
                        matches.append((matching_plan_ids[0], follow_event.group(2), follow_event.group(3), file.name, str(event.start())))
                        break

        same_month_matches = [match for match in matches if _plan_ids_match_same_month(plan_id, match[0])]
        viable_matches = same_month_matches or matches
        if len(viable_matches) > 1:
            candidates = ", ".join(f"{match[0]} ({match[1]}-{match[2]})" for match in viable_matches)
            raise ValueError(f"Foram encontrados múltiplos blocos [BlastingPlan] compatíveis com o plano {plan_id}: {candidates}.")
        if viable_matches:
            _, date_str, time_str, _, _ = viable_matches[0]
            return _format_histo_datetime(date_str, time_str)

        if not allow_unmatched_plan_fallback:
            raise ValueError(f"Não foi encontrado no HISTO um disparo associado ao plano {plan_id}.")

    events: list[tuple[str, str, str, int]] = []
    for file in histo_files:
        text = read_text(file)
        for idx, match in enumerate(re.finditer(r"\[Fire\](\d{4}/\d{2}/\d{2})-(\d{2}:\d{2}:\d{2})", text)):
            events.append((file.name, match.group(1), match.group(2), idx))
    if not events:
        raise ValueError("Não foi encontrado nenhum evento [Fire] válido nos arquivos HISTO.")
    file_name, date_str, time_str, _ = sorted(events, reverse=True)[0]
    return _format_histo_datetime(date_str, time_str)


def load_project_frame(path: Path) -> pd.DataFrame:
    df = read_table(path)
    rename = {
        "UTM_X": "X_project",
        "UTM_Y": "Y_project",
        "Length_m": "p_length",
        "Stemming_m": "p_stemming",
        "Diameter_mm": "Diameter_mm",
        "Subdrilling_m": "p_subdrilling",
        "Angle_deg": "p_angle",
        "Azimuth_deg": "p_azimuth",
        "Total_Charge_kg": "p_explosive",
    }
    return df.rename(columns={k: v for k, v in rename.items() if k in df.columns})


def load_final_frame(path: Path) -> pd.DataFrame:
    df = read_table(path)
    rename = {
        "Length": "r_length",
        "Stemming": "r_stemming",
        "Diameter": "Diameter_m",
        "Subdrilling": "r_subdrilling",
        "Angle": "r_angle",
        "Azimuth": "r_azimuth",
        "InputedCharge": "r_explosive",
    }
    return df.rename(columns={k: v for k, v in rename.items() if k in df.columns})


def merge_frames(project: pd.DataFrame, final: pd.DataFrame, cfg: dict | None = None) -> pd.DataFrame:
    merged = final.merge(project, on="Number", how="left", suffixes=("", "_project"))
    merged["X"] = _series_or_na(merged, "X").fillna(_series_or_na(merged, "X_project"))
    merged["Y"] = _series_or_na(merged, "Y").fillna(_series_or_na(merged, "Y_project"))
    merged["Z"] = _series_or_na(merged, "Z")
    merged["Z_Toe"] = _series_or_na(merged, "Z_Toe")
    merged["p_length"] = _series_or_na(merged, "p_length")
    merged["r_length"] = _series_or_na(merged, "r_length")
    merged["p_stemming"] = _series_or_na(merged, "p_stemming")
    merged["r_stemming"] = _series_or_na(merged, "r_stemming")
    merged["p_explosive"] = _series_or_na(merged, "p_explosive")
    merged["r_explosive"] = _series_or_na(merged, "r_explosive")
    merged["r_angle"] = _series_or_na(merged, "r_angle")
    merged["r_azimuth"] = _series_or_na(merged, "r_azimuth")
    merged["r_subdrilling"] = _series_or_na(merged, "r_subdrilling")
    merged["p_subdrilling"] = _series_or_na(merged, "p_subdrilling")
    merged["DetonatingTime"] = _series_or_na(merged, "DetonatingTime")
    include_eliminated = bool(cfg and cfg.get("business", {}).get("include_eliminated", False))
    if "eliminated" in merged.columns and not include_eliminated:
        merged = merged[pd.to_numeric(merged["eliminated"], errors="coerce").fillna(0) == 0].copy()
    merged = merged.sort_values("Number").reset_index(drop=True)
    return merged


def build_output_frame(merged: pd.DataFrame, plan_id: str, blast_date: str, blast_time: str, cfg: dict) -> pd.DataFrame:
    diameter = _series_or_na(merged, "Diameter_m")
    diameter = diameter.where(diameter.isna() | (diameter >= 1), (diameter * 1000 / 25.4))
    detonating_time, imputed_count = _fill_missing_detonating_time(
        _series_or_na(merged, "DetonatingTime"),
        cfg["business"].get("fill_missing_detonating_time", True),
    )
    stemming_real, stemming_variation_count = _apply_stemming_variation(
        _series_or_na(merged, "r_stemming"),
        _series_or_na(merged, "Number"),
        plan_id,
        cfg["business"].get("simulate_stemming_variation", False),
        float(cfg["business"].get("simulate_stemming_variation_max", 0.12)),
    )
    stemming_real = pd.to_numeric(stemming_real, errors="coerce").round(1)
    merged.attrs["imputed_detonating_time_count"] = imputed_count
    merged.attrs["stemming_variation_count"] = stemming_variation_count
    charge_values, zero_charge_count = _redistribute_zero_charges(
        _series_or_na(merged, "r_explosive"),
        cfg["business"].get("redistribute_zero_charges", False),
        cfg["business"].get("charge_total_target_kg"),
        float(cfg["business"].get("charge_zero_fill_min_kg", 0.01)),
    )
    charge_values, charge_total_adjusted = _enforce_charge_total_target(
        charge_values,
        cfg["business"].get("enforce_charge_total_target", False),
        cfg["business"].get("charge_total_target_kg"),
    )
    data = pd.DataFrame(
        {
            "Data": blast_date,
            "Horario": blast_time,
            "Plano": plan_id,
            "Tipo": cfg["business"].get("output_type_label", "producao"),
            "id": pd.to_numeric(merged["Number"], errors="coerce").astype("Int64"),
            "y": _series_or_na(merged, "Y"),
            "x": _series_or_na(merged, "X"),
            "Z (crest)": _series_or_na(merged, "Z"),
            "Z (toe)": _series_or_na(merged, "Z_Toe"),
            "profundidade prevista": _series_or_na(merged, "p_length"),
            "profundidade realizada": _series_or_na(merged, "r_length"),
            "azimute": _series_or_na(merged, "r_azimuth"),
            "inclinacao": _series_or_na(merged, "r_angle"),
            "cargas previstas": _series_or_na(merged, "p_explosive"),
            "cargas realizadas": charge_values,
            "tampao previsto": _series_or_na(merged, "p_stemming"),
            "tampao realizado": stemming_real,
            "subfuracao": _series_or_na(merged, "r_subdrilling").fillna(_series_or_na(merged, "p_subdrilling")),
            "diametro": diameter,
            "tempo detonacao (ms)": detonating_time,
        }
    )
    if zero_charge_count:
        merged.attrs["zero_charge_count"] = zero_charge_count
    merged.attrs["charge_total_adjusted"] = charge_total_adjusted
    return data


def build_summary(merged: pd.DataFrame, data: pd.DataFrame, plan_id: str, blast_date: str, blast_time: str, sources: dict) -> pd.DataFrame:
    rows = [
        ["Plano", plan_id],
        ["Data", blast_date],
        ["Hora", blast_time],
        ["Total de furos", int(len(data))],
        ["Profundidade total (m)", round(float(pd.to_numeric(data["profundidade realizada"], errors="coerce").sum()), 2)],
        ["Carga total (kg)", round(float(pd.to_numeric(data["cargas realizadas"], errors="coerce").sum()), 2)],
        ["Arquivo projeto", sources["project"].name],
        ["Arquivo realizado", sources["final"].name],
        ["Arquivo PDF", sources["plan_pdf"].name if sources["plan_pdf"] else "-"],
    ]
    return pd.DataFrame(rows, columns=["Campo", "Valor"])
