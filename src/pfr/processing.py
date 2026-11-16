from __future__ import annotations

import re
import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from pypdf import PdfReader

from .io import read_table, read_text
from .validation import validate_signature_hole
from .charge_distribution import ChargeDistributionError, distribute_charges, redistribute_zero_charges


def _series_or_na(df: pd.DataFrame, column: str) -> pd.Series:
    if column in df.columns:
        return pd.to_numeric(df[column], errors="coerce")
    return pd.Series(np.nan, index=df.index)


def _unique_integer_sequence(lower: int | None, upper: int | None, count: int, forbidden: set[int]) -> list[int]:
    if count <= 0:
        return []

    available_interior = 0
    if lower is not None and upper is not None and upper > lower:
        blocked = sum(1 for value in forbidden if lower < value < upper)
        available_interior = max(0, upper - lower - 1 - blocked)

    if lower is not None and upper is not None and upper > lower and available_interior >= count:
        chosen: list[int] = []
        previous = lower
        for index in range(1, count + 1):
            remaining = count - index
            value = max(previous + 1, int(np.floor(lower + ((upper - lower) * index) / (count + 1))))
            max_value = upper - remaining - 1
            while value <= max_value and (value in forbidden or value in chosen):
                value += 1
            if value > max_value:
                break
            chosen.append(value)
            previous = value
        if len(chosen) == count:
            return chosen

    if upper is not None and lower is None:
        candidates: list[int] = []
        value = upper - 1
        while len(candidates) < count and value >= 0:
            if value not in forbidden:
                candidates.append(value)
            value -= 1
        if len(candidates) == count:
            return list(reversed(candidates))

    chosen = []
    value = lower + 1 if lower is not None else (upper + 1 if upper is not None else 1)
    while len(chosen) < count:
        value = max(0, int(value))
        while value in forbidden or value in chosen:
            value += 1
        chosen.append(value)
        value += 1
    return chosen



def _fill_missing_detonating_time(series: pd.Series, enabled: bool) -> tuple[pd.Series, int]:
    values = pd.to_numeric(series, errors="coerce")
    if not enabled:
        return values.round(0).astype("Int64"), 0

    normalized = values.round(0).where(values >= 0)
    result = pd.Series(pd.NA, index=values.index, dtype="Int64")
    forbidden: set[int] = set()
    for position, value in enumerate(normalized.tolist()):
        if pd.isna(value):
            continue
        integer_value = int(value)
        if integer_value in forbidden:
            continue
        result.iloc[position] = integer_value
        forbidden.add(integer_value)

    imputed = 0

    start = 0
    while start < len(result):
        if not pd.isna(result.iloc[start]):
            start += 1
            continue

        end = start
        while end < len(result) and pd.isna(result.iloc[end]):
            end += 1

        left_value = next((int(result.iloc[index]) for index in range(start - 1, -1, -1) if not pd.isna(result.iloc[index])), None)
        right_value = next((int(result.iloc[index]) for index in range(end, len(result)) if not pd.isna(result.iloc[index])), None)

        block_count = end - start
        block_values = _unique_integer_sequence(left_value, right_value, block_count, forbidden)
        for offset, value in enumerate(block_values):
            result.iloc[start + offset] = value
            forbidden.add(int(value))
            imputed += 1

        start = end

    return result, imputed


def _apply_stemming_variation(
    values: pd.Series,
    numbers: pd.Series,
    plan_id: str,
    enabled: bool,
    max_delta: float,
    preserved: pd.Series | None = None,
) -> tuple[pd.Series, int]:
    base = pd.to_numeric(values, errors="coerce")
    if not enabled:
        return base, 0

    preserved_flags = (
        list(preserved.reindex(base.index, fill_value=False).astype(bool))
        if preserved is not None
        else [False] * len(base)
    )
    varied = base.copy()
    count = 0
    for idx, (number, value) in enumerate(zip(pd.to_numeric(numbers, errors="coerce"), base, strict=False)):
        if pd.isna(value) or pd.isna(number) or preserved_flags[idx]:
            continue
        seed = f"{plan_id}:{int(number)}:stemming"
        digest = hashlib.sha256(seed.encode("utf-8")).digest()
        magnitude = (int.from_bytes(digest[:4], "big") / 0xFFFFFFFF) * max_delta
        sign = 1 if digest[4] % 2 else -1
        adjusted = max(0.0, float(value) + (sign * magnitude))
        varied.iloc[idx] = round(adjusted, 2)
        count += 1
    return varied, count


def _business_number(cfg: dict, key: str) -> float:
    """Lê business.<key> obrigatório; valor ausente ou não numérico gera erro explícito (sem padrão escondido)."""
    business = cfg.get("business", {})
    if key not in business:
        raise ValueError(f"business.{key} é obrigatório em config.yaml para esta configuração de carga.")
    value = business[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"business.{key} deve ser um número em config.yaml.")
    return float(value)


def _charge_list(charges: pd.Series) -> list[float | None]:
    """Cargas como lista; vazio vira None. Seis casas decimais, como a resolução do site."""
    numbers = pd.to_numeric(charges, errors="coerce").astype(float)
    return [None if pd.isna(value) else round(float(value), 6) for value in numbers]


def _fixed_positions(values: pd.Series, preserved: pd.Series | None) -> list[int]:
    if preserved is None:
        return []
    flags = preserved.reindex(values.index, fill_value=False).astype(bool).to_numpy()
    return [position for position, flag in enumerate(flags) if flag]


def _redistribute_zero_charges(
    charges: pd.Series,
    cfg: dict,
    preserved: pd.Series | None = None,
) -> tuple[pd.Series, int, list[str]]:
    """Redistribuição padrão de zeros (mesma regra do site: escada para zerados, valores distintos, total exato)."""
    values = pd.to_numeric(charges, errors="coerce").astype(float)
    if not cfg.get("business", {}).get("redistribute_zero_charges", False):
        return values, 0, []
    raw = _charge_list(values)
    fixed = _fixed_positions(values, preserved)
    fixed_set = set(fixed)
    zero_count = sum(1 for position, value in enumerate(raw) if value == 0 and position not in fixed_set)
    notes: list[str] = []
    try:
        distributed = redistribute_zero_charges(
            raw,
            enabled=True,
            zero_minimum=_business_number(cfg, "charge_zero_fill_min_kg"),
            zero_step_kg=_business_number(cfg, "charge_zero_fill_step_kg"),
            fixed_indexes=fixed,
            notes=notes,
        )
    except ChargeDistributionError as error:
        raise ValueError(f"Redistribuição de cargas zeradas: {error}") from error
    return pd.Series(distributed, index=values.index, dtype=float), zero_count, notes


def _enforce_charge_total_target(
    charges: pd.Series,
    cfg: dict,
    preserved: pd.Series | None = None,
) -> tuple[pd.Series, bool, list[str]]:
    """Fecha o total em business.charge_total_target_kg (mesma regra da carga-alvo do site)."""
    values = pd.to_numeric(charges, errors="coerce").astype(float)
    business = cfg.get("business", {})
    if not business.get("enforce_charge_total_target", False):
        return values, False, []
    if business.get("charge_total_target_kg") is None:
        raise ValueError("business.charge_total_target_kg é obrigatório quando enforce_charge_total_target está ativo.")
    target = _business_number(cfg, "charge_total_target_kg")
    raw = _charge_list(values)
    positions = [position for position, value in enumerate(raw) if value is not None]
    if len(positions) < 3:
        raise ValueError("São necessários pelo menos 3 furos com carga válida para fechar o total preservando os extremos.")
    fixed_positions = set(_fixed_positions(values, preserved))
    subset = [raw[position] for position in positions]
    subset_fixed = [k for k, position in enumerate(positions) if position in fixed_positions]
    adjustable_subset = [value for k, value in enumerate(subset) if k not in subset_fixed]
    if not adjustable_subset:
        raise ValueError("Não há furos ajustáveis para fechar a carga-alvo: todos os furos com carga são de assinatura.")
    lowest = min(adjustable_subset)
    highest = max(subset)
    minimum_index = next(k for k, value in enumerate(subset) if value == lowest and k not in subset_fixed)
    if lowest <= 0:
        raise ValueError("A carga-alvo não pode ser distribuída com furo de carga zero sem redistribuir os zerados: ative business.redistribute_zero_charges.")
    maximum_indexes = [k for k, value in enumerate(subset) if value == highest]
    notes: list[str] = []
    try:
        distributed = distribute_charges(
            subset,
            target,
            step_kg=_business_number(cfg, "charge_minimum_step_kg"),
            minimum_index=minimum_index,
            minimum_value=lowest,
            maximum_index=maximum_indexes[0],
            maximum_value=highest,
            maximum_indexes=maximum_indexes,
            fixed_indexes=subset_fixed,
            notes=notes,
        )
    except ChargeDistributionError as error:
        raise ValueError(f"Carga-alvo: {error}") from error
    adjusted = values.copy()
    for k, position in enumerate(positions):
        adjusted.iat[position] = distributed[k]
    return adjusted, True, notes


def _extract_plan_id_from_input_files(cfg: dict, sources) -> str | None:
    filenames: list[str] = []
    for attr in ("plan_pdf", "project", "final"):
        path = getattr(sources, attr, None)
        if path is not None:
            name = path.name if hasattr(path, "name") else Path(str(path)).name
            if name:
                filenames.append(name)
    input_root = cfg.get("paths", {}).get("input_root")
    if input_root:
        try:
            for entry in Path(input_root).iterdir():
                if entry.is_file():
                    filenames.append(entry.name)
        except OSError:
            pass
    candidates: list[str] = []
    for filename in filenames:
        matches = _PLAN_ID_PATTERN.findall(filename)
        for match in matches:
            if match not in candidates:
                candidates.append(match)
    if not candidates:
        return None
    pdf_name = sources.plan_pdf.name if sources.plan_pdf and hasattr(sources.plan_pdf, "name") else ""
    for candidate in candidates:
        if pdf_name and candidate in pdf_name:
            plan_id = candidate[2:] if candidate.upper().startswith("PP") else candidate
            return plan_id
    plan_id = candidates[0][2:] if candidates[0].upper().startswith("PP") else candidates[0]
    return plan_id


def extract_plan_id(plan_pdf: Path | None, histo_files: tuple[Path, ...], cfg: dict, sources=None) -> str:
    business = cfg.get("business", {})
    source = str(business.get("plan_id_source", "auto")).strip().lower()
    fallback = str(business.get("fallback_plan_id", "")).strip()
    if source == "fallback":
        if not fallback:
            raise ValueError("business.fallback_plan_id deve ser informado quando plan_id_source=fallback.")
        candidate = _extract_plan_id_from_input_files(cfg, sources) if sources else None
        return candidate if candidate else fallback
    regex = re.compile(cfg["business"]["plan_id_regex"])
    if plan_pdf and plan_pdf.exists():
        try:
            text = " ".join(page.extract_text() or "" for page in PdfReader(str(plan_pdf)).pages)
            match = regex.search(text)
            if match:
                return match.group(1)
        except Exception:
            pass
    for histo in histo_files:
        try:
            text = read_text(histo)
            # O .log novo também contém números de seis ou mais dígitos em
            # DELAYS, checksums e contadores. Um identificador explicitamente
            # prefixado por PP tem precedência sobre esses números genéricos.
            explicit_plan_ids = _PLAN_ID_PATTERN.findall(text)
            for explicit_plan_id in explicit_plan_ids:
                match = regex.search(explicit_plan_id)
                if match:
                    return match.group(1)
                return explicit_plan_id[2:]

            match = regex.search(text)
            if match:
                return match.group(1)
        except Exception:
            pass
    if sources:
        candidate = _extract_plan_id_from_input_files(cfg, sources)
        if candidate:
            return candidate
    if fallback:
        return fallback
    raise ValueError("Não foi possível identificar o ID do plano nos anexos e não há fallback configurado.")


@dataclass(frozen=True)
class _HistoEvent:
    name: str
    date: str
    time: str
    timestamp: datetime
    body: str
    file: Path
    position: int


_HISTO_EVENT_PATTERN = re.compile(
    r"(?m)^[ \t]*\[(?P<name>[^\]\r\n]+)\][ \t]*"
    r"(?:(?P<date>\d{4}/\d{1,2}/\d{1,2})-)?"
    r"(?P<time>\d{1,2}:\d{1,2}:\d{1,2})?[^\r\n]*"
)


_PLAN_ID_PATTERN = re.compile(r"\bPP(?:[\s._/-]*\d){6,8}(?:[_-][A-Z])?\b", re.IGNORECASE)


def _parse_timezone_offset(value: float | str | None) -> float:
    if value is None or value == "":
        return 0.0

    if isinstance(value, str):
        normalized = value.strip().upper()
        if normalized.startswith("UTC"):
            normalized = normalized[3:].strip()
        if not normalized:
            return 0.0

        clock_match = re.fullmatch(r"(?P<sign>[+-]?)(?P<hours>\d{1,2}):(?P<minutes>[0-5]\d)", normalized)
        if clock_match:
            sign = -1 if clock_match.group("sign") == "-" else 1
            parsed = sign * (int(clock_match.group("hours")) + int(clock_match.group("minutes")) / 60)
        else:
            try:
                parsed = float(normalized)
            except ValueError as exc:
                raise ValueError(
                    "O deslocamento de fuso deve ser um número de horas ou no formato ±HH:MM."
                ) from exc
    else:
        try:
            parsed = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "O deslocamento de fuso deve ser um número de horas ou no formato ±HH:MM."
            ) from exc

    if not math.isfinite(parsed) or abs(parsed) > 24:
        raise ValueError("O deslocamento de fuso deve estar entre -24 e +24 horas.")
    return parsed


def _parse_histo_events(path: Path) -> list[_HistoEvent]:
    text = read_text(path)
    headers = list(_HISTO_EVENT_PATTERN.finditer(text))
    events: list[_HistoEvent] = []
    current_date = ""
    for index, header in enumerate(headers):
        explicit_date = header.group("date")
        if explicit_date:
            try:
                current_date = datetime.strptime(explicit_date, "%Y/%m/%d").strftime("%Y/%m/%d")
            except ValueError:
                current_date = ""
        raw_time = header.group("time")
        if not raw_time or not current_date:
            continue
        try:
            date = current_date
            time = datetime.strptime(raw_time, "%H:%M:%S").strftime("%H:%M:%S")
            timestamp = datetime.strptime(
                f"{date}-{time}",
                "%Y/%m/%d-%H:%M:%S",
            )
        except ValueError:
            continue
        name = header.group("name").strip()
        if name.casefold() == "blastplan":
            name = "BlastingPlan"
        body_end = headers[index + 1].start() if index + 1 < len(headers) else len(text)
        events.append(
            _HistoEvent(
                name=name,
                date=date,
                time=time,
                timestamp=timestamp,
                body=text[header.end():body_end],
                file=path,
                position=header.start(),
            )
        )
    return events


def _event_sort_key(event: _HistoEvent) -> tuple[datetime, float, str, int]:
    try:
        modified = event.file.stat().st_mtime
    except OSError:
        modified = 0.0
    return event.timestamp, modified, event.file.name.casefold(), event.position


def _format_histo_datetime(
    date_str: str,
    time_str: str,
    timezone_offset_hours: float | str | None = 0.0,
    *,
    timezone_offset: float | str | None = None,
) -> tuple[str, str]:
    if timezone_offset is not None:
        if timezone_offset_hours not in (None, 0, 0.0, "", "0", "+0", "-0"):
            raise ValueError("Informe apenas um parâmetro de deslocamento de fuso.")
        timezone_offset_hours = timezone_offset
    offset = _parse_timezone_offset(timezone_offset_hours)
    timestamp = datetime.strptime(
        f"{date_str}-{time_str}",
        "%Y/%m/%d-%H:%M:%S",
    ) + timedelta(hours=offset)
    return timestamp.strftime("%d/%m/%Y"), timestamp.strftime("%H:%M:%S")


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
    timezone_offset_hours: float | str | None = 0.0,
    *,
    timezone_offset: float | str | None = None,
) -> tuple[str, str]:
    if timezone_offset is not None:
        if timezone_offset_hours not in (None, 0, 0.0, "", "0", "+0", "-0"):
            raise ValueError("Informe apenas um parâmetro de deslocamento de fuso.")
        timezone_offset_hours = timezone_offset
    offset = _parse_timezone_offset(timezone_offset_hours)

    grouped_events = [
        (file, _parse_histo_events(file))
        for file in sorted(histo_files, key=lambda item: str(item).casefold())
    ]

    if plan_id:
        matches: list[tuple[str, _HistoEvent, _HistoEvent]] = []
        for _, events in grouped_events:
            for index, event in enumerate(events):
                if event.name == "BlastingPlan":
                    matching_plan_ids = [
                        candidate for candidate in _PLAN_ID_PATTERN.findall(event.body)
                        if _plan_ids_match(plan_id, candidate)
                    ]
                    if not matching_plan_ids:
                        continue

                    next_plan_index = next(
                        (
                            candidate_index
                            for candidate_index in range(index + 1, len(events))
                            if events[candidate_index].name == "BlastingPlan"
                        ),
                        len(events),
                    )
                    fire = next(
                        (candidate for candidate in events[index + 1:next_plan_index] if candidate.name == "Fire"),
                        None,
                    )
                    if fire is not None:
                        matches.append((matching_plan_ids[0], fire, event))
                    continue

                if event.name != "StartProcedure":
                    continue

                matching_plan_ids = [
                    candidate for candidate in _PLAN_ID_PATTERN.findall(event.body)
                    if _plan_ids_match(plan_id, candidate)
                ]
                if not matching_plan_ids:
                    continue

                next_procedure_index = next(
                    (
                        candidate_index
                        for candidate_index in range(index + 1, len(events))
                        if events[candidate_index].name in {"StartProcedure", "Stop", "PowerOn", "HistoryEnd"}
                    ),
                    len(events),
                )
                fires = [
                    candidate for candidate in events[index + 1:next_procedure_index]
                    if candidate.name == "Fire"
                ]
                if fires:
                    # O primeiro Fire marca o início do disparo associado ao
                    # StartProcedure; os demais podem ser registros por BMO.
                    matches.append((matching_plan_ids[0], fires[0], event))

        same_month_matches = [match for match in matches if _plan_ids_match_same_month(plan_id, match[0])]
        viable_matches = same_month_matches or matches
        if len(viable_matches) > 1:
            candidates = ", ".join(
                f"{match[0]} ({match[1].date}-{match[1].time})"
                for match in viable_matches
            )
            raise ValueError(f"Foram encontrados múltiplos blocos [BlastingPlan] compatíveis com o plano {plan_id}: {candidates}.")
        if viable_matches:
            _, fire, _ = viable_matches[0]
            return _format_histo_datetime(fire.date, fire.time, offset)

        if not allow_unmatched_plan_fallback:
            raise ValueError(f"Não foi encontrado no HISTO um disparo associado ao plano {plan_id}.")

    fire_events = [event for _, events in grouped_events for event in events if event.name == "Fire"]
    if not fire_events:
        raise ValueError("Não foi encontrado nenhum evento [Fire] válido nos arquivos HISTO.")
    latest_fire = max(fire_events, key=_event_sort_key)
    return _format_histo_datetime(latest_fire.date, latest_fire.time, offset)


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
    include_eliminated = bool(
        cfg.get("business", {}).get("include_eliminated", True)
        if cfg
        else True
    )
    eliminated_values = (
        pd.to_numeric(merged["eliminated"], errors="coerce").fillna(0)
        if "eliminated" in merged.columns
        else pd.Series(0, index=merged.index, dtype="float64")
    )
    eliminated_mask = eliminated_values.ne(0)
    excluded_eliminated_count = int(eliminated_mask.sum()) if not include_eliminated else 0
    if not include_eliminated and "eliminated" in merged.columns:
        merged = merged[pd.to_numeric(merged["eliminated"], errors="coerce").fillna(0) == 0].copy()
    merged = merged.sort_values("Number").reset_index(drop=True)
    merged.attrs["source_final_count"] = len(final)
    merged.attrs["included_eliminated_count"] = int(eliminated_mask.sum()) if include_eliminated else 0
    merged.attrs["excluded_eliminated_count"] = excluded_eliminated_count
    return merged


def build_output_frame(
    merged: pd.DataFrame,
    plan_id: str,
    blast_date: str,
    blast_time: str,
    cfg: dict,
    signature_mask: pd.Series | None = None,
) -> pd.DataFrame:
    # Furo de assinatura (SPEC.md, "Furo de assinatura"): nenhuma regra de ajuste de valor (carga, carga-alvo,
    # variação de tampão) se aplica a ele. Conversões, arredondamentos e formatação seguem a regra normal.
    if signature_mask is None:
        signature_mask = validate_signature_hole(merged, cfg)
    preserved = signature_mask.reindex(merged.index, fill_value=False).astype(bool)

    diameter_raw = _series_or_na(merged, "Diameter_m")
    diameter = diameter_raw.where(diameter_raw.isna() | (diameter_raw >= 1), (diameter_raw * 1000 / 25.4))

    detonating_raw = _series_or_na(merged, "DetonatingTime")
    detonating_time, imputed_count = _fill_missing_detonating_time(
        detonating_raw,
        cfg["business"].get("fill_missing_detonating_time", True),
    )
    if preserved.any():
        # O furo não pode ter o tempo imputado: a única alteração permitida é o arredondamento para inteiro.
        expected_time = detonating_raw.round(0)[preserved].astype(float)
        if (detonating_time[preserved].astype(float) != expected_time).any():
            raise ValueError("O tempo de detonação do furo de assinatura foi imputado; ele não pode ser alterado.")

    stemming_raw = _series_or_na(merged, "r_stemming")
    stemming_real, stemming_variation_count = _apply_stemming_variation(
        stemming_raw,
        _series_or_na(merged, "Number"),
        plan_id,
        cfg["business"].get("simulate_stemming_variation", False),
        float(cfg["business"].get("simulate_stemming_variation_max", 0.12)),
        preserved,
    )
    stemming_real = pd.to_numeric(stemming_real, errors="coerce").round(1)
    merged.attrs["imputed_detonating_time_count"] = imputed_count
    merged.attrs["stemming_variation_count"] = stemming_variation_count
    merged.attrs["signature_hole_count"] = int(preserved.sum())

    charge_raw = _series_or_na(merged, "r_explosive")
    charge_values, zero_charge_count, zero_notes = _redistribute_zero_charges(charge_raw, cfg, preserved)
    charge_values, charge_total_adjusted, enforce_notes = _enforce_charge_total_target(charge_values, cfg, preserved)
    charge_notes = [*zero_notes, *enforce_notes]
    charge_values = charge_values.where(~preserved, charge_raw)
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
    merged.attrs["charge_notes"] = charge_notes
    return data


def build_summary(plan_id: str, blast_date: str, blast_time: str) -> pd.DataFrame:
    return pd.DataFrame([[plan_id, blast_date, blast_time]], columns=["Plano", "Data", "Hora"])
