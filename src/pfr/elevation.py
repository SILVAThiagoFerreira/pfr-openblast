"""Cota (Z) do realizado. Regras em SPEC.md, seção "Cota (Z) do realizado"; espelho em public/elevation.js.

- Z (crest): Z do Config Final quando é cota plausível (faixa `business.elevation_plausible_*`).
  Senão, Z Collar do Plano de Perfuração do mesmo Number, desde que X/Y do Config Final estejam
  a até `business.elevation_design_match_tolerance_m` do X/Y Collar do plano. Senão, vazio com aviso.
- Z (toe): Z_Toe do Config Final quando o Z (crest) também veio do Config Final e o valor é cota plausível.
  Senão, Z (crest) - r_length * cos(r_angle), com aviso.
- Nenhum furo com cota: não bloqueia. Z (crest) e Z (toe) ficam em branco e o aviso
  "Nenhum furo com cota; Z em branco" é o primeiro da lista.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _numeric(df: pd.DataFrame, column: str) -> pd.Series:
    if column in df.columns:
        return pd.to_numeric(df[column], errors="coerce")
    return pd.Series(np.nan, index=df.index, dtype="float64")


def _fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".").replace(".", ",")


def resolve_elevations(merged: pd.DataFrame, design: pd.DataFrame | None, cfg: dict) -> tuple[pd.DataFrame, list[str]]:
    business = cfg["business"]
    low = float(business["elevation_plausible_min_m"])
    high = float(business["elevation_plausible_max_m"])
    tolerance = float(business["elevation_design_match_tolerance_m"])

    result = merged.copy()
    numbers = _numeric(result, "Number")
    x = _numeric(result, "X")
    y = _numeric(result, "Y")
    z_final = _numeric(result, "Z")
    z_toe_final = _numeric(result, "Z_Toe")
    length = _numeric(result, "r_length")
    angle = _numeric(result, "r_angle")

    plan_x = pd.Series(np.nan, index=result.index)
    plan_y = pd.Series(np.nan, index=result.index)
    plan_z = pd.Series(np.nan, index=result.index)
    ambiguous: set[float] = set()
    if design is not None and not design.empty:
        plan = pd.DataFrame(
            {
                "id": pd.to_numeric(design["ID"], errors="coerce"),
                "x": pd.to_numeric(design["X Collar"], errors="coerce"),
                "y": pd.to_numeric(design["Y Collar"], errors="coerce"),
                "z": pd.to_numeric(design["Z Collar"], errors="coerce"),
            }
        ).dropna(subset=["id"])
        duplicated = plan["id"].duplicated(keep=False)
        ambiguous = set(plan.loc[duplicated, "id"].tolist())
        plan = plan.loc[~duplicated].set_index("id")
        plan_x = numbers.map(plan["x"])
        plan_y = numbers.map(plan["y"])
        plan_z = numbers.map(plan["z"])

    distance = np.hypot(x - plan_x, y - plan_y)
    final_valid = z_final.between(low, high)
    design_valid = plan_z.between(low, high) & (distance <= tolerance)
    crest = z_final.where(final_valid, plan_z.where(design_valid))
    crest_source = pd.Series(np.where(final_valid, "final", np.where(design_valid, "design", "")), index=result.index)

    toe_from_final = (crest_source == "final") & z_toe_final.between(low, high)
    toe_computed = ~toe_from_final & crest.notna() & length.notna() & angle.notna()
    computed = crest - length * np.cos(np.radians(angle))
    toe = z_toe_final.where(toe_from_final, computed).where(toe_from_final | toe_computed)

    result["Z"] = crest
    result["Z_Toe"] = toe

    warnings: list[str] = []
    invalid_final = z_final.notna() & ~final_valid
    if invalid_final.any():
        examples = "; ".join(
            f"{int(number)} = {_fmt(value)}"
            for number, value in zip(numbers[invalid_final].head(3), z_final[invalid_final].head(3))
        )
        warnings.append(
            f"Config Final: o Z de {int(invalid_final.sum())} furo(s) não é cota (fora da faixa de {low:g} a {high:g} m; "
            f"ex.: {examples}). Esses valores têm a ordem de grandeza das coordenadas X e não foram usados como cota."
        )

    design_count = int((crest_source == "design").sum())
    if design_count:
        warnings.append(
            f"Z (crest) de {design_count} furo(s) obtido do Plano de Perfuração (Z Collar), com X/Y conferidos "
            f"(tolerância de {_fmt(tolerance)} m)."
        )

    missing_rows = crest.isna()
    if missing_rows.any():
        items = []
        for index in result.index[missing_rows]:
            number = numbers.loc[index]
            if pd.isna(z_final.loc[index]):
                reason = "Z ausente no Config Final"
            elif pd.isna(number) or number in ambiguous:
                reason = "ID repetido no plano de perfuração" if number in ambiguous else "ID ausente"
            elif design is None or design.empty:
                reason = "Plano de Perfuração não anexado"
            elif pd.isna(plan_z.loc[index]):
                reason = "não consta no plano de perfuração"
            elif pd.isna(distance.loc[index]):
                reason = "X/Y ausente para conferir com o plano"
            elif distance.loc[index] > tolerance:
                reason = f"X/Y diverge do plano em {_fmt(float(distance.loc[index]))} m"
            else:
                reason = "Z Collar do plano fora da faixa de cota"
            items.append(f"{int(number) if not pd.isna(number) else '?'} ({reason})")
        listed = "; ".join(items[:10]) + (f"; e mais {len(items) - 10}" if len(items) > 10 else "")
        warnings.append(
            f"Sem cota (Z) válida para {int(missing_rows.sum())} furo(s): {listed}. "
            "Z (crest) e Z (toe) ficam em branco nesses furos."
        )

    toe_computed_count = int(toe_computed.sum())
    if toe_computed_count:
        warnings.append(
            f"Z (toe) de {toe_computed_count} furo(s) calculado como Z (crest) - profundidade realizada * cos(inclinação), "
            "porque o Z_Toe do Config Final não foi usado para esses furos."
        )

    resolved = int(crest.notna().sum())
    if len(result) and resolved == 0:
        warnings.insert(
            0,
            "Nenhum furo com cota; Z em branco. O Z do Config Final não é cota (faixa de "
            f"{low:g} a {high:g} m) e nenhum Z Collar do Plano de Perfuração foi conferido "
            f"(X/Y dentro de {_fmt(tolerance)} m).",
        )
    return result, warnings
