from __future__ import annotations

import re
import shutil
import unicodedata
from datetime import datetime
from pathlib import Path

import pandas as pd


COLUMN_ALIASES = {
    "UTM X": "UTM_X",
    "UTM Y": "UTM_Y",
    "Length (m)": "Length_m",
    "Stemming (m)": "Stemming_m",
    "Diameter (mm)": "Diameter_mm",
    "Subdrilling (m)": "Subdrilling_m",
    "Angle (º)": "Angle_deg",
    "Angle (°)": "Angle_deg",
    "Azimuth (º)": "Azimuth_deg",
    "Azimuth (°)": "Azimuth_deg",
    "Total_Charge (Kg)": "Total_Charge_kg",
}


def read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in {".xlsx", ".xlsm"}:
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path, skipinitialspace=True)
    df.columns = [str(col).strip() for col in df.columns]
    df = df.rename(columns={col: COLUMN_ALIASES[col] for col in df.columns if col in COLUMN_ALIASES})
    return df


def _sheet_key(name: str) -> str:
    text = unicodedata.normalize("NFD", str(name)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", text.lower())


def read_design_table(path: Path, sheet_pattern: str) -> pd.DataFrame:
    """Lê o Plano de Perfuração (planilha): a aba cujo nome contém `sheet_pattern` (sem acentos nem caixa), ou a primeira."""
    sheets = pd.read_excel(path, sheet_name=None)
    pattern = _sheet_key(sheet_pattern)
    name = next((sheet for sheet in sheets if pattern and pattern in _sheet_key(sheet)), next(iter(sheets)))
    df = sheets[name]
    df.columns = [str(col).strip() for col in df.columns]
    return df


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def backup_inputs(paths: list[Path | None], backup_root: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = backup_root / stamp
    target.mkdir(parents=True, exist_ok=True)
    for path in paths:
        if path and path.exists() and path.is_file():
            shutil.copy2(path, target / path.name)
    return target
