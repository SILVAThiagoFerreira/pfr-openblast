from __future__ import annotations

import shutil
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
