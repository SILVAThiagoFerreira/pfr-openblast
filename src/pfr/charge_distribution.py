"""Distribuição de cargas realizadas (CLI), com a mesma regra do site (public/charge.js).

Porta fiel do algoritmo JavaScript: as duas implementações devem devolver exatamente os mesmos valores
(verificado por tests/test_charge_parity.py contra o Node). Nenhum valor é arredondado silenciosamente:
entradas inválidas geram ChargeDistributionError com a causa.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

SCALE = 10**6  # resolução interna de 1e-6 kg
TOP_GAP_UNITS = 10000  # 0,01 kg entre as cargas mais altas e o máximo preservado
TIE_STEP_UNITS = 1000  # 0,001 kg entre cargas de origem iguais
BISECTION_STEPS = 200


class ChargeDistributionError(ValueError):
    """Entrada ou alvo que não pode ser distribuído com a regra de cargas distintas."""


def js_round(value: float) -> int:
    """Math.round do JavaScript (meio arredonda para cima)."""
    return math.floor(value + 0.5)


def has_at_most_six_decimals(value: float) -> bool:
    return abs(value * SCALE - js_round(value * SCALE)) < 1e-6


def format_kg(units: float) -> str:
    text = f"{units / SCALE:.6f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _triangular(count: int) -> int:
    return (count * (count + 1)) // 2


def _strictly_increasing(items: list[dict]) -> list[dict]:
    ordered = sorted(items, key=lambda item: (item["base"], item["index"]))
    for position in range(1, len(ordered)):
        if ordered[position]["base"] <= ordered[position - 1]["base"]:
            ordered[position]["base"] = ordered[position - 1]["base"] + TIE_STEP_UNITS
    return ordered


def _break_load_ties(units_by_index: dict, bounds: dict, pinned_units: Iterable[int]) -> bool:
    pinned = list(pinned_units)
    for _ in range(10 * len(units_by_index) + 100):
        holders: dict[int, list[int]] = {}
        for index, units in units_by_index.items():
            holders.setdefault(units, []).append(index)
        for units in pinned:
            holders.setdefault(units, []).append(-1)
        repeated = next(((units, owners) for units, owners in holders.items() if len(owners) > 1), None)
        if repeated is None:
            return True
        units, owners = repeated
        free_owners = [owner for owner in owners if owner >= 0]
        if not free_owners:
            return False
        mover = free_owners[-1]
        others = [index for index in units_by_index if index != mover]
        if units + 1 <= bounds[mover]["hi"] and (units + 1) not in holders:
            donor = next((index for index in others
                          if units_by_index[index] - 1 >= bounds[index]["lo"]
                          and (units_by_index[index] - 1) not in holders), None)
            if donor is not None:
                units_by_index[mover] = units + 1
                units_by_index[donor] -= 1
                continue
        if units - 1 >= bounds[mover]["lo"] and (units - 1) not in holders:
            donor = next((index for index in others
                          if units_by_index[index] + 1 <= bounds[index]["hi"]
                          and (units_by_index[index] + 1) not in holders), None)
            if donor is not None:
                units_by_index[mover] = units - 1
                units_by_index[donor] += 1
                continue
        return False
    return False


def redistribute_zero_charges(
    values: Sequence[float | None],
    *,
    enabled: bool,
    zero_minimum: float,
    zero_step_kg: float,
    fixed_indexes: Iterable[int] = (),
    notes: list[str] | None = None,
) -> list[float | None]:
    """Redistribuição padrão (sem alvo): escada para zerados, demais furos com valores distintos, total exato."""
    values = list(values)
    if not enabled:
        return values.copy()
    if not (math.isfinite(zero_minimum) and zero_minimum > 0 and has_at_most_six_decimals(zero_minimum)):
        raise ChargeDistributionError("A carga mínima dos furos zerados deve ser maior que zero, com até seis casas decimais.")
    if not (math.isfinite(zero_step_kg) and zero_step_kg > 0 and has_at_most_six_decimals(zero_step_kg)):
        raise ChargeDistributionError("O passo entre os furos zerados deve ser maior que zero, com até seis casas decimais.")
    fixed = set(fixed_indexes)
    if any(index < 0 or index >= len(values) for index in fixed):
        raise ChargeDistributionError("O furo de assinatura não existe na lista de cargas.")

    units: list[int | None] = []
    for index, value in enumerate(values):
        if value is None:
            units.append(None)
            continue
        if not math.isfinite(value) or value < 0 or not has_at_most_six_decimals(value):
            raise ChargeDistributionError(
                f"A carga realizada do furo {index + 1} não é válida para a redistribuição "
                "(use um número não negativo com até seis casas decimais)."
            )
        units.append(js_round(value * SCALE))

    valid = [index for index in range(len(values)) if units[index] is not None]
    positive = [index for index in valid if units[index] > 0]
    if not positive:
        if any(units[index] == 0 and index not in fixed for index in valid):
            raise ChargeDistributionError("Não há cargas positivas para redistribuir a carga zerada preservando os extremos.")
        return values.copy()

    min_units = min(units[index] for index in positive)
    max_units = max(units[index] for index in positive)
    min_index = next((index for index in positive if units[index] == min_units and index in fixed), None)
    if min_index is None:
        min_index = next(index for index in positive if units[index] == min_units)
    max_indexes = [index for index in positive if units[index] == max_units]
    pinned = {min_index, *max_indexes, *fixed}
    zero_indexes = [index for index in valid if units[index] == 0 and index not in fixed]
    free_indexes = [index for index in positive if index not in pinned]
    minimum_units = js_round(zero_minimum * SCALE)
    requested_step_units = js_round(zero_step_kg * SCALE)
    if zero_indexes and minimum_units >= min_units:
        raise ChargeDistributionError(
            f"A carga mínima dos furos zerados ({format_kg(minimum_units)} kg) deve ser menor que a menor carga "
            f"positiva do plano ({format_kg(min_units)} kg)."
        )
    step_units = requested_step_units
    step_reduced = False
    if len(zero_indexes) > 1:
        step_units = min(requested_step_units, (min_units - minimum_units - 1) // (len(zero_indexes) - 1))
        if step_units < 1:
            raise ChargeDistributionError(
                f"Os {len(zero_indexes)} furos zerados não cabem em escada entre {format_kg(minimum_units)} kg "
                f"e a menor carga positiva ({format_kg(min_units)} kg)."
            )
        step_reduced = step_units < requested_step_units
    zero_units = {index: minimum_units + step_units * position for position, index in enumerate(zero_indexes)}
    stair_total = sum(zero_units.values())
    total_units = sum(units[index] for index in valid)
    pinned_total = sum((units[index] or 0) for index in pinned)
    free_target = total_units - pinned_total - stair_total
    free_floor = len(free_indexes) * min_units
    if not free_indexes and stair_total > 0:
        raise ChargeDistributionError("Não há furos intermediários para receber a carga dos furos zerados.")
    if free_target < free_floor:
        raise ChargeDistributionError("Não há carga suficiente acima da menor carga positiva para receber a escada dos furos zerados.")
    value_counts: dict[int, int] = {}
    for index in positive:
        value_counts[units[index]] = value_counts.get(units[index], 0) + 1
    tied_free_count = sum(1 for index in free_indexes if value_counts[units[index]] > 1)

    ordered = _strictly_increasing([{"index": index, "base": units[index]} for index in free_indexes])
    excess_sum = sum(item["base"] - min_units for item in ordered)
    extra = free_target - free_floor
    if extra < 0 or extra > excess_sum:
        raise ChargeDistributionError("Falha interna ao redistribuir as cargas zeradas.")
    scaled: dict[int, int] = {}
    if excess_sum == 0:
        for item in ordered:
            scaled[item["index"]] = min_units
    elif ordered:
        factor = extra / excess_sum
        exact = [(item["base"] - min_units) * factor for item in ordered]
        floors = [math.floor(value) for value in exact]
        leftover = extra - sum(floors)
        if leftover < 0 or leftover > len(ordered):
            raise ChargeDistributionError("Falha interna ao arredondar a redistribuição das cargas zeradas.")
        by_fraction = sorted(range(len(ordered)), key=lambda p: (-(exact[p] - floors[p]), p))
        for position in by_fraction[:leftover]:
            floors[position] += 1
        for position, item in enumerate(ordered):
            scaled[item["index"]] = min_units + floors[position]
    bounds = {item["index"]: {"lo": min_units, "hi": max_units - 1} for item in ordered}
    movable = {item["index"]: scaled[item["index"]] for item in ordered}
    if any(value < min_units or value > max_units - 1 for value in movable.values()):
        raise ChargeDistributionError("Não há como redistribuir a carga dos zerados mantendo todas as cargas entre a menor e a maior carga.")
    pinned_values = {min_units, max_units, *zero_units.values(),
                     *(units[index] for index in fixed if units[index] is not None)}
    if not _break_load_ties(movable, bounds, pinned_values):
        raise ChargeDistributionError(
            "Não foi possível manter todas as cargas distintas na redistribuição padrão: faltam furos livres "
            "para separar as repetições sem alterar a menor ou a maior carga."
        )

    result: list[float | None] = []
    for index, value in enumerate(values):
        if index in pinned:
            result.append(value)
        elif index in zero_units:
            result.append(zero_units[index] / SCALE)
        elif index in movable:
            result.append(movable[index] / SCALE)
        else:
            result.append(value)
    output_units = [None if value is None else js_round(value * SCALE) for value in result]
    if sum((unit or 0) for unit in output_units) != total_units:
        raise ChargeDistributionError("A redistribuição não fechou exatamente no total de entrada.")
    output_counts: dict[int, int] = {}
    for unit in output_units:
        if unit is not None:
            output_counts[unit] = output_counts.get(unit, 0) + 1
    if any(count > 1 and unit != max_units for unit, count in output_counts.items()):
        raise ChargeDistributionError(
            "Não foi possível manter todas as cargas distintas na redistribuição padrão: faltam furos livres "
            "para separar as repetições sem alterar a menor ou a maior carga."
        )
    if notes is not None:
        if step_reduced:
            notes.append(
                f"Os {len(zero_indexes)} furos zerados ficam abaixo da menor carga positiva do plano "
                f"({format_kg(min_units)} kg); o passo entre eles foi reduzido de {format_kg(requested_step_units)} kg "
                f"para {format_kg(step_units)} kg."
            )
        if tied_free_count > 0:
            notes.append(
                f"{tied_free_count} furos com carga repetida na entrada foram separados "
                f"(passo de {format_kg(TIE_STEP_UNITS)} kg entre cargas iguais); o total continua igual."
            )
    return result


def _scale_group(entries: list[dict], minimum_units: int, maximum_units: int, total_units: int) -> dict | None:
    """Distribui total_units entre entries (bases estritamente crescentes) com pisos e tetos distintos."""
    count = len(entries)
    if not count:
        return {"units": [], "lo": [], "hi": []}
    top_gap = min(TOP_GAP_UNITS, math.floor((count * maximum_units - total_units) / _triangular(count)))
    if top_gap < 1:
        return None
    lo = [minimum_units + (position + 1) for position in range(count)]
    hi = [maximum_units - top_gap * (count - position) for position in range(count)]
    if any(lo[position] >= hi[position] for position in range(count)):
        return None
    excess = [entry["base"] - minimum_units for entry in entries]

    def values_at(scale: float) -> list[float]:
        return [min(hi[p], max(lo[p], minimum_units + scale * excess[p])) for p in range(count)]

    def sum_at(scale: float) -> float:
        return sum(values_at(scale))

    if sum_at(0) > total_units:
        return None
    scale_low = 0.0
    scale_high = max((hi[p] - minimum_units) / excess[p] for p in range(count))
    if sum_at(scale_high) < total_units:
        return None
    for _ in range(BISECTION_STEPS):
        middle = (scale_low + scale_high) / 2
        if sum_at(middle) < total_units:
            scale_low = middle
        else:
            scale_high = middle
    real = values_at(scale_high)
    units = [math.floor(value) for value in real]
    leftover = total_units - sum(units)
    candidates = sorted(
        (p for p in range(count) if units[p] < hi[p]),
        key=lambda p: (-(real[p] - units[p]), p),
    )
    if leftover < 0 or leftover > len(candidates):
        raise ChargeDistributionError("Falha interna ao arredondar a distribuição de cargas.")
    for step in range(leftover):
        units[candidates[step]] += 1
    return {"units": units, "lo": lo, "hi": hi}


def distribute_charges(
    values: Sequence[float],
    target: float,
    *,
    step_kg: float,
    minimum_index: int | None = None,
    minimum_value: float | None = None,
    maximum_index: int | None = None,
    maximum_value: float | None = None,
    maximum_indexes: Sequence[int] | None = None,
    fixed_indexes: Iterable[int] = (),
    notes: list[str] | None = None,
) -> list[float]:
    """Fecha o total em `target` com cargas distintas, mantendo mínimo, máximo preservado e furos fixos."""
    charges_in = list(values)
    if len(charges_in) < 3:
        raise ChargeDistributionError("São necessários pelo menos três furos para distribuir uma carga-alvo preservando os extremos.")
    if not (math.isfinite(target) and target > 0):
        raise ChargeDistributionError("O total de carga realizada deve ser um número maior que zero.")
    for index, value in enumerate(charges_in):
        if not math.isfinite(value) or value < 0:
            raise ChargeDistributionError(f"A carga realizada do furo {index + 1} não é válida para a distribuição.")
    charges = charges_in
    default_minimum = min(charges)
    default_maximum = max(charges)
    if minimum_index is None:
        minimum_index = charges.index(default_minimum)
    if maximum_index is None:
        maximum_index = next((i for i, v in enumerate(charges) if i != minimum_index and v == default_maximum), -1)
    count = len(charges)
    if not (0 <= minimum_index < count and 0 <= maximum_index < count and minimum_index != maximum_index):
        raise ChargeDistributionError("Não foi possível identificar furos extremos distintos para distribuir a carga.")
    max_indexes = sorted(set(maximum_indexes)) if maximum_indexes is not None else [maximum_index]
    if (not max_indexes or any(not (0 <= i < count) for i in max_indexes)
            or maximum_index not in max_indexes or minimum_index in max_indexes):
        raise ChargeDistributionError("Não foi possível identificar furos extremos distintos para distribuir a carga.")
    fixed_list = sorted(set(fixed_indexes))
    if any(not (0 <= i < count) or i == minimum_index for i in fixed_list):
        raise ChargeDistributionError("O furo de assinatura não pode ser o furo de menor carga: a carga dele é preservada como veio da entrada.")
    fixed = set(fixed_list)
    has_explicit_minimum = minimum_value is not None
    minimum = minimum_value if has_explicit_minimum else charges[minimum_index]
    maximum = maximum_value if maximum_value is not None else charges[maximum_index]
    if not math.isfinite(minimum) or minimum < 0 or (has_explicit_minimum and minimum == 0):
        raise ChargeDistributionError("A carga mínima por furo deve ser um número maior que zero.")
    if not math.isfinite(maximum) or maximum < 0:
        raise ChargeDistributionError("A maior carga preservada deve ser um número maior ou igual a zero.")
    if minimum > maximum:
        raise ChargeDistributionError("A carga mínima informada não pode ser maior que a maior carga preservada da planilha.")
    if not (math.isfinite(step_kg) and step_kg > 0):
        raise ChargeDistributionError("O passo de carga entre furos (charge_minimum_step_kg em config.yaml) deve ser um número maior que zero.")

    adjustable = [i for i in range(count) if i != minimum_index and i not in max_indexes and i not in fixed]
    if not adjustable:
        raise ChargeDistributionError("Não há furos intermediários disponíveis para distribuir a carga-alvo.")
    for value in [minimum, maximum, *(charges[i] for i in fixed_list)]:
        if not has_at_most_six_decimals(value):
            raise ChargeDistributionError("A carga mínima, a maior carga preservada e as cargas fixas devem ter no máximo seis casas decimais.")

    minimum_units = js_round(minimum * SCALE)
    maximum_units = js_round(maximum * SCALE)
    target_units = js_round(target * SCALE)
    fixed_units = [js_round(charges[i] * SCALE) for i in fixed_list]
    fixed_sum = sum(fixed_units)
    preserved_maximum_count = sum(1 for i in max_indexes if i not in fixed)
    free_count = len(adjustable)
    free_target_units = target_units - minimum_units - preserved_maximum_count * maximum_units - fixed_sum
    plain_lower = free_count * minimum_units
    plain_upper = free_count * maximum_units
    if free_target_units < plain_lower or free_target_units > plain_upper:
        lower = (minimum_units + preserved_maximum_count * maximum_units + fixed_sum + plain_lower) / SCALE
        upper = (minimum_units + preserved_maximum_count * maximum_units + fixed_sum + plain_upper) / SCALE
        raise ChargeDistributionError(
            f"O alvo é impossível mantendo a menor e a maior carga. Para estes furos, use um total entre "
            f"{lower:.2f} kg e {upper:.2f} kg."
        )
    if maximum_units == minimum_units:
        raise ChargeDistributionError("A carga mínima não pode ser igual à maior carga preservada: os demais furos teriam que repetir esse valor.")
    if free_target_units < plain_lower + _triangular(free_count) or free_target_units > plain_upper - _triangular(free_count):
        raise ChargeDistributionError("O alvo está tão perto do menor ou do maior valor possível que não há como manter todas as cargas distintas. Ajuste o total.")

    low_indexes = sorted((i for i in adjustable if charges[i] <= minimum), key=lambda i: (charges[i], i))
    above_indexes = [i for i in adjustable if charges[i] > minimum]
    real_candidates = [
        js_round(charges[i] * SCALE)
        for i in [*adjustable, *fixed_list]
        if i != minimum_index and i not in max_indexes and charges[i] > minimum
    ]
    next_real_units = min([maximum_units, *real_candidates])
    room_units = next_real_units - minimum_units
    requested_step_units = js_round(step_kg * SCALE)
    fit_step_units = room_units // (len(low_indexes) + 1)
    bound_step_units = (maximum_units - minimum_units - 1) // (len(low_indexes) + 1)
    step_units = max(1, min(requested_step_units, fit_step_units, bound_step_units))
    if low_indexes and step_units < requested_step_units and notes is not None:
        notes.append(
            f"Os {len(low_indexes)} furos de carga baixa ficam abaixo da próxima carga real do plano "
            f"({format_kg(next_real_units)} kg); o passo entre eles foi ajustado para {format_kg(step_units)} kg "
            f"(teto de {format_kg(requested_step_units)} kg)."
        )
    if step_units * (len(low_indexes) + 1) >= maximum_units - minimum_units:
        raise ChargeDistributionError("A faixa entre a carga mínima e a maior carga preservada é pequena demais para os furos de carga baixa.")
    staircase = {i: minimum_units + step_units * (position + 1) for position, i in enumerate(low_indexes)}
    staircase_total = sum(staircase.values())

    def base_units(index: int) -> int:
        if index in staircase:
            return staircase[index]
        return max(minimum_units + 1, js_round(charges[index] * SCALE))

    plan = None
    if above_indexes:
        ordered = _strictly_increasing([{"index": i, "base": base_units(i)} for i in above_indexes])
        solved = _scale_group(ordered, minimum_units, maximum_units, free_target_units - staircase_total)
        if solved is not None:
            plan = {"ordered": ordered, "solved": solved, "staircase_kept": True}
    elif free_target_units == staircase_total:
        plan = {"ordered": [], "solved": {"units": [], "lo": [], "hi": []}, "staircase_kept": True}
    if plan is None:
        if low_indexes and notes is not None:
            notes.append("O total não coube só com os demais furos: os furos de carga baixa também subiram na mesma proporção.")
        ordered = _strictly_increasing([{"index": i, "base": base_units(i)} for i in adjustable])
        solved = _scale_group(ordered, minimum_units, maximum_units, free_target_units)
        if solved is None:
            raise ChargeDistributionError("Não há como distribuir o total com cargas distintas entre os furos. Ajuste o total.")
        plan = {"ordered": ordered, "solved": solved, "staircase_kept": False}

    final_units: dict[int, int] = {}
    bounds: dict[int, dict] = {}
    for position, item in enumerate(plan["ordered"]):
        final_units[item["index"]] = plan["solved"]["units"][position]
        bounds[item["index"]] = {"lo": plan["solved"]["lo"][position], "hi": plan["solved"]["hi"][position]}
    staircase_kept = plan["staircase_kept"]
    if staircase_kept:
        for index, units in staircase.items():
            final_units[index] = units
    pinned_units = list(fixed_units)
    if staircase_kept:
        pinned_units.extend(staircase.values())
    movable = {index: units for index, units in final_units.items() if not (staircase_kept and index in staircase)}
    movable_bounds = {index: bounds[index] for index in movable if index in bounds}
    if not _break_load_ties(movable, movable_bounds, pinned_units):
        raise ChargeDistributionError("Não foi possível manter todas as cargas distintas com este total. Ajuste o total.")
    for index, units in movable.items():
        final_units[index] = units

    result: list[float] = []
    for index in range(count):
        if index == minimum_index:
            result.append(minimum)
        elif index in fixed:
            result.append(charges[index])
        elif index in max_indexes:
            result.append(maximum)
        else:
            result.append(final_units[index] / SCALE)
    if sum(js_round(value * SCALE) for value in result) != target_units:
        raise ChargeDistributionError("A distribuição não fechou exatamente no total informado. Tente um alvo com até seis casas decimais.")
    free_values = [js_round(result[i] * SCALE) for i in adjustable]
    if len(set(free_values)) != len(free_values):
        raise ChargeDistributionError("Não foi possível manter todas as cargas distintas com este total. Ajuste o total.")
    return result
