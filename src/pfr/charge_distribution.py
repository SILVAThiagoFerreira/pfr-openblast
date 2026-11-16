"""Distribuição de cargas realizadas (CLI), com a mesma regra do site (public/charge.js).

Porta fiel do algoritmo JavaScript: as duas implementações devem devolver exatamente os mesmos valores e avisos
(verificado por tests/test_charge_parity.py contra o Node). Regra da janela (SPEC.md, "Janela de furos vizinhos"):
nenhum furo fica a menos de `window_min_gap_kg` de um furo a até `window_size` posições dele, na ordem do número.
Pares de dois furos fixos (menor carga, maior carga preservada ou assinatura) mantêm a carga da entrada e são avisados.
Nenhum valor é arredondado silenciosamente: entradas inválidas geram ChargeDistributionError com a causa.
"""

from __future__ import annotations

import math
from typing import Callable, Iterable, Sequence

SCALE = 10**6  # resolução interna de 1e-6 kg
CENT_UNITS = 10000  # passo da redução automática da diferença mínima (0,01 kg)
BISECTION_STEPS = 200


class ChargeDistributionError(ValueError):
    """Entrada ou alvo que não pode ser distribuído com a regra da janela de furos vizinhos."""


def js_round(value: float) -> int:
    """Math.round do JavaScript (meio arredonda para cima)."""
    return math.floor(value + 0.5)


def has_at_most_six_decimals(value: float) -> bool:
    return abs(value * SCALE - js_round(value * SCALE)) < 1e-6


def format_kg(units: float) -> str:
    text = f"{units / SCALE:.6f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _validate_window(window_size: int, window_min_gap_kg: float) -> None:
    if isinstance(window_size, bool) or not isinstance(window_size, int) or window_size < 1:
        raise ChargeDistributionError("A janela de furos vizinhos (charge_window_size em config.yaml) deve ser um inteiro maior que zero.")
    if not (math.isfinite(window_min_gap_kg) and window_min_gap_kg > 0 and has_at_most_six_decimals(window_min_gap_kg)):
        raise ChargeDistributionError(
            "A diferença mínima entre furos vizinhos (charge_window_min_gap_kg em config.yaml) deve ser maior que zero, "
            "com até seis casas decimais."
        )


def _find_window_violation(
    units: Sequence[int], window_size: int, gap_of: Callable[[int, int], int], pinned: Sequence[bool]
) -> tuple[int, int] | None:
    """Primeira violação da janela. Pares de furos fixos não entram: eles mantêm a carga da entrada (aviso em notes)."""
    count = len(units)
    for i in range(count):
        for j in range(i + 1, min(count - 1, i + window_size) + 1):
            if pinned[i] and pinned[j]:
                continue
            if abs(units[i] - units[j]) < gap_of(i, j):
                return (i, j)
    return None


def _count_pinned_conflicts(units: Sequence[int], pinned: Sequence[bool], window_size: int, gap: int) -> int:
    """Quantos pares de furos fixos a até window_size posições estão a menos de gap um do outro."""
    count = len(units)
    total = 0
    for i in range(count):
        for j in range(i + 1, min(count - 1, i + window_size) + 1):
            if pinned[i] and pinned[j] and abs(units[i] - units[j]) < gap:
                total += 1
    return total


def _pinned_conflict_note(total: int, window_size: int, gap_units_max: int) -> str:
    pairs = "1 par de furos fixos" if total == 1 else f"{total} pares de furos fixos"
    return (
        f"{pairs} (menor carga, maior carga preservada ou assinatura) ficam a até {window_size} posições com diferença "
        f"menor que {format_kg(gap_units_max)} kg; eles não podem ser ajustados e foram mantidos como vieram da entrada."
    )


def _scale_to_total(base: Sequence[int], min_units: int, max_units: int, total_units: int) -> list[int] | None:
    """Escala o excesso de cada valor acima de min_units até somar total_units (cada valor entre min e max − 1)."""
    count = len(base)
    upper = max_units - 1
    if not count:
        return [] if total_units == 0 else None
    if count * min_units > total_units or count * upper < total_units:
        return None
    excess = [max(0, value - min_units) for value in base]
    positive = [value for value in excess if value > 0]
    if not positive:
        return [min_units] * count if count * min_units == total_units else None

    def values_at(scale: float) -> list[float]:
        return [min(upper, max(min_units, min_units + scale * value)) for value in excess]

    def sum_at(scale: float) -> float:
        # Soma sequencial, como o reduce do JavaScript (sum() do Python pode usar soma compensada e divergir).
        total = 0
        for value in values_at(scale):
            total = total + value
        return total

    scale_low = 0.0
    scale_high = (upper - min_units) / min(positive)
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
        (position for position in range(count) if units[position] < upper),
        key=lambda position: (-(real[position] - units[position]), position),
    )
    if leftover < 0 or leftover > len(candidates):
        raise ChargeDistributionError("Falha interna ao arredondar a distribuição de cargas.")
    for step in range(leftover):
        units[candidates[step]] += 1
    return units


def _repair_window(
    units: list[int],
    lo: Sequence[int],
    hi: Sequence[int],
    pinned: Sequence[bool],
    window_size: int,
    gap_of: Callable[[int, int], int],
) -> bool:
    """Ajusta `units` (in place) até não haver violação, com ajuste mínimo e compensação em outro furo livre."""
    count = len(units)

    def neighbors_of(index: int) -> list[int]:
        return [p for p in range(max(0, index - window_size), min(count - 1, index + window_size) + 1) if p != index]

    def is_clear(index: int) -> bool:
        return all(abs(units[index] - units[p]) >= gap_of(index, p) for p in neighbors_of(index))

    def move_off(mover: int) -> bool:
        current = units[mover]
        neighbors = neighbors_of(mover)
        points = {lo[mover], hi[mover]}
        for p in neighbors:
            points.add(units[p] + gap_of(mover, p))
            points.add(units[p] - gap_of(mover, p))
        candidates = sorted(
            (
                x
                for x in points
                if lo[mover] <= x <= hi[mover]
                and x != current
                and all(abs(x - units[p]) >= gap_of(mover, p) for p in neighbors)
            ),
            key=lambda x: (abs(x - current), x),
        )
        for x in candidates:
            delta = x - current
            for k in range(1, count):
                for donor in (mover - k, mover + k):
                    if donor < 0 or donor >= count or pinned[donor]:
                        continue
                    before = units[donor]
                    target = before - delta
                    if target < lo[donor] or target > hi[donor]:
                        continue
                    units[mover] = x
                    units[donor] = target
                    if is_clear(mover) and is_clear(donor):
                        return True
                    units[mover] = current
                    units[donor] = before
        return False

    guard_limit = count * window_size * 4 + 100
    for _ in range(guard_limit):
        pair = _find_window_violation(units, window_size, gap_of, pinned)
        if pair is None:
            return True
        movers = [index for index in (pair[1], pair[0]) if not pinned[index]]
        if not any(move_off(mover) for mover in movers):
            return False
    return False


def _largest_feasible_gap(gap_units_max: int, attempt: Callable[[int], object | None]) -> tuple[object, int] | None:
    """Maior diferença mínima entre o teto e 0,01 kg com solução. Retorna (resultado, diferença) ou None."""
    first = attempt(gap_units_max)
    if first is not None:
        return first, gap_units_max
    max_steps = (gap_units_max - 1) // CENT_UNITS
    chosen = attempt(CENT_UNITS) if max_steps >= 1 else None
    if chosen is None:
        return None
    low = 1
    high = max_steps + 1
    while high - low > 1:
        middle = (low + high) // 2
        nxt = attempt(middle * CENT_UNITS)
        if nxt is not None:
            low = middle
            chosen = nxt
        else:
            high = middle
    return chosen, low * CENT_UNITS


def redistribute_zero_charges(
    values: Sequence[float | None],
    *,
    enabled: bool,
    zero_minimum: float,
    window_size: int,
    window_min_gap_kg: float,
    fixed_indexes: Iterable[int] = (),
    notes: list[str] | None = None,
) -> list[float | None]:
    """Redistribuição padrão (sem alvo): escada cíclica para zerados, regra da janela, total exato."""
    values = list(values)
    if not enabled:
        return values.copy()
    if not (math.isfinite(zero_minimum) and zero_minimum > 0 and has_at_most_six_decimals(zero_minimum)):
        raise ChargeDistributionError("A carga mínima dos furos zerados deve ser maior que zero, com até seis casas decimais.")
    _validate_window(window_size, window_min_gap_kg)
    fixed_list = list(fixed_indexes)
    if any(index < 0 or index >= len(values) for index in fixed_list):
        raise ChargeDistributionError("O furo de assinatura não existe na lista de cargas.")
    fixed = set(fixed_list)

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
    gap_units_max = js_round(window_min_gap_kg * SCALE)
    if zero_indexes and minimum_units >= min_units:
        raise ChargeDistributionError(
            f"A carga mínima dos furos zerados ({format_kg(minimum_units)} kg) deve ser menor que a menor carga "
            f"positiva do plano ({format_kg(min_units)} kg)."
        )
    if zero_indexes and not free_indexes:
        raise ChargeDistributionError("Não há furos intermediários para receber a carga dos furos zerados.")
    # Entre dois zerados, a escada cíclica usa W+1 níveis abaixo da menor carga positiva (zero, +g, … +W·g).
    zero_room_units = (min_units - 1 - minimum_units) // window_size if len(zero_indexes) > 1 else math.inf
    if len(zero_indexes) > 1 and zero_room_units < 1:
        raise ChargeDistributionError(
            f"Os {len(zero_indexes)} furos zerados não cabem com {window_size} furos vizinhos distintos entre "
            f"{format_kg(minimum_units)} kg e a menor carga positiva ({format_kg(min_units)} kg)."
        )
    total_units = sum(units[index] for index in valid)
    pinned_total = sum((units[index] or 0) for index in pinned)

    def build_base(gap: int) -> tuple[dict[int, int], int] | None:
        zero_gap = min(gap, zero_room_units)
        zero_levels = [minimum_units + (position % (window_size + 1)) * zero_gap for position in range(len(zero_indexes))]
        zero_total = sum(zero_levels)
        scaled_free = _scale_to_total(
            [units[index] for index in free_indexes], min_units, max_units, total_units - pinned_total - zero_total
        )
        if scaled_free is None:
            return None
        base: dict[int, int] = {}
        for index in valid:
            if index in pinned:
                base[index] = units[index]
        for position, index in enumerate(zero_indexes):
            base[index] = zero_levels[position]
        for position, index in enumerate(free_indexes):
            base[index] = scaled_free[position]
        return base, zero_gap

    def run_window(gap: int) -> tuple[list[int], list[int], list[bool], int] | None:
        built = build_base(gap)
        if built is None:
            return None
        base, zero_gap = built
        seq_base = [base[index] for index in valid]
        pinned_flags = [index in pinned for index in valid]
        zero_like = [value < min_units for value in seq_base]
        lo = [
            value if pinned_flags[position] else (minimum_units if zero_like[position] else min_units)
            for position, value in enumerate(seq_base)
        ]
        hi = [
            value if pinned_flags[position] else (min_units - 1 if zero_like[position] else max_units - 1)
            for position, value in enumerate(seq_base)
        ]

        def gap_of(a: int, b: int) -> int:
            return zero_gap if zero_like[a] and zero_like[b] else gap

        seq = list(seq_base)
        if not _repair_window(seq, lo, hi, pinned_flags, window_size, gap_of):
            return None
        if _find_window_violation(seq, window_size, gap_of, pinned_flags) is not None:
            raise ChargeDistributionError("Falha interna: a janela de furos vizinhos ficou violada após a redistribuição.")
        return seq, seq_base, pinned_flags, zero_gap

    found = _largest_feasible_gap(gap_units_max, run_window)
    if found is None:
        probe = build_base(CENT_UNITS)
        if probe is None:
            zero_total = sum(
                minimum_units + (position % (window_size + 1)) * min(CENT_UNITS, zero_room_units)
                for position in range(len(zero_indexes))
            )
            if total_units - pinned_total - zero_total < len(free_indexes) * min_units:
                raise ChargeDistributionError("Não há carga suficiente acima da menor carga positiva para receber a escada dos furos zerados.")
            raise ChargeDistributionError("Não há espaço abaixo da maior carga para receber a carga dos furos zerados sem repetir a maior carga.")
        raise ChargeDistributionError(
            f"Não há como manter cargas distintas entre furos vizinhos (até {window_size} posições) com estes furos e "
            "este total, sem alterar a menor ou a maior carga."
        )
    (seq, seq_base, pinned_flags, zero_gap_units), gap_units = found
    changed = sum(1 for position, value in enumerate(seq) if value != seq_base[position])
    pinned_conflicts = _count_pinned_conflicts(seq_base, pinned_flags, window_size, gap_units_max)

    output_by_index = {index: seq[position] for position, index in enumerate(valid)}
    result: list[float | None] = []
    for index, value in enumerate(values):
        if index not in output_by_index or index in pinned:
            result.append(value)
        else:
            result.append(output_by_index[index] / SCALE)
    output_units = [None if value is None else js_round(value * SCALE) for value in result]
    if sum((unit or 0) for unit in output_units) != total_units:
        raise ChargeDistributionError("A redistribuição não fechou exatamente no total de entrada.")
    if notes is not None:
        if zero_gap_units < gap_units:
            notes.append(
                f"Os {len(zero_indexes)} furos zerados ficam em uma faixa curta (abaixo de {format_kg(min_units)} kg): "
                f"a diferença mínima entre eles foi reduzida para {format_kg(zero_gap_units)} kg."
            )
        if gap_units < gap_units_max:
            notes.append(
                f"A diferença mínima entre furos vizinhos ficou em {format_kg(gap_units)} kg (e não "
                f"{format_kg(gap_units_max)} kg): com uma diferença maior, estes furos fixos e zerados não cabem na "
                f"janela de {window_size} posições."
            )
        if pinned_conflicts > 0:
            notes.append(_pinned_conflict_note(pinned_conflicts, window_size, gap_units_max))
        if changed > 0:
            changed_text = "1 furo teve" if changed == 1 else f"{changed} furos tiveram"
            notes.append(
                f"{changed_text} a carga ajustada para manter {format_kg(gap_units)} kg de diferença entre furos vizinhos "
                f"(até {window_size} posições antes ou depois); o total continua igual."
            )
    return result


def distribute_charges(
    values: Sequence[float],
    target: float,
    *,
    step_kg: float,
    window_size: int,
    window_min_gap_kg: float,
    minimum_index: int | None = None,
    minimum_value: float | None = None,
    maximum_index: int | None = None,
    maximum_value: float | None = None,
    maximum_indexes: Sequence[int] | None = None,
    fixed_indexes: Iterable[int] = (),
    notes: list[str] | None = None,
) -> list[float]:
    """Fecha o total em `target`, mantendo mínimo, máximo preservado e furos fixos, com a regra da janela."""
    charges = list(values)
    if len(charges) < 3:
        raise ChargeDistributionError("São necessários pelo menos três furos para distribuir uma carga-alvo preservando os extremos.")
    if not (math.isfinite(target) and target > 0):
        raise ChargeDistributionError("O total de carga realizada deve ser um número maior que zero.")
    for index, value in enumerate(charges):
        if not math.isfinite(value) or value < 0:
            raise ChargeDistributionError(f"A carga realizada do furo {index + 1} não é válida para a distribuição.")
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
    if not max_indexes or any(not (0 <= i < count) for i in max_indexes) or maximum_index not in max_indexes or minimum_index in max_indexes:
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
    _validate_window(window_size, window_min_gap_kg)

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
    plain_upper = free_count * (maximum_units - 1)
    if free_target_units < plain_lower or free_target_units > plain_upper:
        lower = (minimum_units + preserved_maximum_count * maximum_units + fixed_sum + plain_lower) / SCALE
        upper = (minimum_units + preserved_maximum_count * maximum_units + fixed_sum + plain_upper) / SCALE
        raise ChargeDistributionError(
            f"O alvo é impossível mantendo a menor e a maior carga. Para estes furos, use um total entre "
            f"{lower:.2f} kg e {upper:.2f} kg."
        )
    if maximum_units == minimum_units:
        raise ChargeDistributionError("A carga mínima não pode ser igual à maior carga preservada: os demais furos teriam que repetir esse valor.")

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

    final_units: dict[int, int] = {}
    staircase_kept = False
    if above_indexes:
        solved = _scale_to_total([base_units(i) for i in above_indexes], minimum_units, maximum_units, free_target_units - staircase_total)
        if solved is not None:
            for position, index in enumerate(above_indexes):
                final_units[index] = solved[position]
            staircase_kept = True
    elif free_target_units == staircase_total:
        staircase_kept = True
    if staircase_kept:
        final_units.update(staircase)
    else:
        if low_indexes and notes is not None:
            notes.append("O total não coube só com os demais furos: os furos de carga baixa também subiram na mesma proporção.")
        solved = _scale_to_total([base_units(i) for i in adjustable], minimum_units, maximum_units, free_target_units)
        if solved is None:
            raise ChargeDistributionError("Não há como distribuir o total entre os furos mantendo a menor e a maior carga. Ajuste o total.")
        for position, index in enumerate(adjustable):
            final_units[index] = solved[position]

    # Sequência completa (todos os furos, na ordem do número): fixos e extremos pinados; os demais são livres.
    seq_base = [0] * count
    lo = [0] * count
    hi = [0] * count
    pinned_flags = [False] * count
    for index in range(count):
        if index == minimum_index:
            seq_base[index] = minimum_units
            lo[index] = hi[index] = minimum_units
            pinned_flags[index] = True
        elif index in fixed:
            seq_base[index] = js_round(charges[index] * SCALE)
            lo[index] = hi[index] = seq_base[index]
            pinned_flags[index] = True
        elif index in max_indexes:
            seq_base[index] = maximum_units
            lo[index] = hi[index] = maximum_units
            pinned_flags[index] = True
        else:
            seq_base[index] = final_units[index]
            lo[index] = minimum_units
            hi[index] = maximum_units - 1
    gap_units_max = js_round(window_min_gap_kg * SCALE)

    def run_window(gap: int) -> list[int] | None:
        def gap_of(_a: int, _b: int) -> int:
            return gap

        seq = list(seq_base)
        if not _repair_window(seq, lo, hi, pinned_flags, window_size, gap_of):
            return None
        if _find_window_violation(seq, window_size, gap_of, pinned_flags) is not None:
            raise ChargeDistributionError("Falha interna: a janela de furos vizinhos ficou violada após a distribuição.")
        return seq

    found = _largest_feasible_gap(gap_units_max, run_window)
    if found is None:
        raise ChargeDistributionError(f"Não há como manter cargas distintas entre furos vizinhos (até {window_size} posições) com este total. Ajuste o total.")
    seq, gap_units = found[0], found[1]
    changed = sum(1 for index in range(count) if seq[index] != seq_base[index] and not pinned_flags[index])
    pinned_conflicts = _count_pinned_conflicts(seq_base, pinned_flags, window_size, gap_units_max)

    result: list[float] = []
    for index in range(count):
        if index == minimum_index:
            result.append(minimum)
        elif index in fixed:
            result.append(charges[index])
        elif index in max_indexes:
            result.append(maximum)
        else:
            result.append(seq[index] / SCALE)
    if sum(js_round(value * SCALE) for value in result) != target_units:
        raise ChargeDistributionError("A distribuição não fechou exatamente no total informado. Tente um alvo com até seis casas decimais.")
    if notes is not None:
        if gap_units < gap_units_max:
            notes.append(
                f"A diferença mínima entre furos vizinhos ficou em {format_kg(gap_units)} kg (e não "
                f"{format_kg(gap_units_max)} kg): com uma diferença maior, estes furos fixos não cabem na janela de "
                f"{window_size} posições."
            )
        if pinned_conflicts > 0:
            notes.append(_pinned_conflict_note(pinned_conflicts, window_size, gap_units_max))
        if changed > 0:
            changed_text = "1 furo teve" if changed == 1 else f"{changed} furos tiveram"
            notes.append(
                f"{changed_text} a carga ajustada para manter {format_kg(gap_units)} kg de diferença entre furos vizinhos "
                f"(até {window_size} posições antes ou depois); o total continua igual."
            )
    return result
