"""Regressão da cota (Z) de saída: o Z do Config Final pode ser coordenada X, não cota.

Fixture derivada do cenário REG CRISTA F3 (27/10/2026): furo 171 e demais furos com Z igual
à ordem de grandeza de X no "configuração final.csv"; cota no "Crista_F3.xlsx" (aba PROJETO PERFURAÇÃO).
"""
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import math
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from pfr.config import load_config, normalize_config  # noqa: E402
from pfr.elevation import resolve_elevations  # noqa: E402
from pfr.io import read_design_table  # noqa: E402
from pfr.models import SourceFiles  # noqa: E402
from pfr.validation import validate_sources  # noqa: E402


def _cfg():
    return normalize_config(load_config(ROOT / "config.yaml"), ROOT)


def _merged(rows):
    return pd.DataFrame(rows)


def _design(rows):
    return pd.DataFrame(rows, columns=["ID", "X Collar", "Y Collar", "Z Collar"])


SCENARIO_MERGED = _merged([
    {"Number": 171, "X": 748776.29, "Y": 8930000.78, "Z": 748775.62, "Z_Toe": 748767.506, "r_length": 8.4, "r_angle": 15.0},
    {"Number": 172, "X": 748774.81, "Y": 8929998.76, "Z": 748774.81, "Z_Toe": 748766.81, "r_length": 8.0, "r_angle": 0.0},
    {"Number": 326, "X": 748897.33, "Y": 8930052.64, "Z": 748897.33, "Z_Toe": 748885.33, "r_length": 12.0, "r_angle": 0.0},
    {"Number": 1000, "X": 748899.67, "Y": 8930052.599, "Z": 748899.67, "Z_Toe": 748887.47, "r_length": 12.2, "r_angle": 0.0},
])
SCENARIO_DESIGN = _design([
    [171, 748776.29, 8930000.78, 287.63],
    [172, 748774.81, 8929998.76, 287.50],
    [326, 748897.33, 8930052.64, 292.27],
])


class ElevationTest(unittest.TestCase):
    def test_scenario_uses_design_collar_and_geometry_for_toe(self):
        cfg = _cfg()
        data, warnings = resolve_elevations(SCENARIO_MERGED, SCENARIO_DESIGN, cfg)
        by_number = data.set_index("Number")

        self.assertAlmostEqual(by_number.loc[171, "Z"], 287.63, places=6)
        self.assertAlmostEqual(by_number.loc[171, "Z_Toe"], 287.63 - 8.4 * math.cos(math.radians(15.0)), places=6)
        self.assertAlmostEqual(by_number.loc[171, "Z_Toe"], 279.516223, places=6)
        self.assertAlmostEqual(by_number.loc[172, "Z"], 287.50, places=6)
        self.assertAlmostEqual(by_number.loc[172, "Z_Toe"], 279.50, places=6)
        self.assertAlmostEqual(by_number.loc[326, "Z"], 292.27, places=6)
        self.assertAlmostEqual(by_number.loc[326, "Z_Toe"], 280.27, places=6)
        # Furo fora do plano não recebe a coordenada X como cota.
        self.assertTrue(pd.isna(by_number.loc[1000, "Z"]))
        self.assertTrue(pd.isna(by_number.loc[1000, "Z_Toe"]))
        self.assertLess(data["Z"].dropna().max(), 1000)

        text = "\n".join(warnings)
        self.assertIn("Config Final: o Z de 4 furo(s) não é cota", text)
        self.assertIn("Z (crest) de 3 furo(s) obtido do Plano de Perfuração", text)
        self.assertIn("Sem cota (Z) válida para 1 furo(s): 1000 (não consta no plano de perfuração)", text)

    def test_valid_final_elevation_is_kept_without_design(self):
        cfg = _cfg()
        merged = _merged([{"Number": 197, "X": 748839.83, "Y": 8930511.09, "Z": 209.759, "Z_Toe": 199.259, "r_length": 10.5, "r_angle": 0.0}])
        data, warnings = resolve_elevations(merged, None, cfg)
        self.assertAlmostEqual(data.loc[0, "Z"], 209.759, places=6)
        self.assertAlmostEqual(data.loc[0, "Z_Toe"], 199.259, places=6)
        self.assertEqual(warnings, [])

    def test_invalid_final_toe_is_computed_from_crest(self):
        cfg = _cfg()
        merged = _merged([{"Number": 5, "X": 1.0, "Y": 2.0, "Z": 100.0, "Z_Toe": 748000.0, "r_length": 10.0, "r_angle": 0.0}])
        data, _ = resolve_elevations(merged, None, cfg)
        self.assertAlmostEqual(data.loc[0, "Z"], 100.0, places=6)
        self.assertAlmostEqual(data.loc[0, "Z_Toe"], 90.0, places=6)

    def test_design_xy_outside_tolerance_is_not_used(self):
        cfg = _cfg()
        merged = _merged([
            {"Number": 171, "X": 748776.29, "Y": 8930000.78, "Z": 748775.62, "Z_Toe": 748767.506, "r_length": 8.4, "r_angle": 15.0},
            {"Number": 175, "X": 748779.78, "Y": 8929998.76, "Z": 748777.78, "Z_Toe": 748769.28, "r_length": 8.5, "r_angle": 0.0},
        ])
        design = _design([[171, 748776.29, 8930000.78, 287.63], [175, 748777.78, 8929998.76, 287.81]])
        data, warnings = resolve_elevations(merged, design, cfg)
        by_number = data.set_index("Number")
        self.assertTrue(pd.isna(by_number.loc[175, "Z"]))
        self.assertAlmostEqual(by_number.loc[171, "Z"], 287.63, places=6)
        self.assertIn("175 (X/Y diverge do plano em 2 m)", "\n".join(warnings))

    def test_no_valid_elevation_stops_with_explicit_error(self):
        cfg = _cfg()
        with self.assertRaisesRegex(ValueError, "Não há cota \\(Z\\) válida para nenhum furo"):
            resolve_elevations(SCENARIO_MERGED.iloc[:2], None, cfg)

    def test_design_sheet_is_selected_by_name_and_validated(self):
        cfg = _cfg()
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            design_path = root / "Crista_F3.xlsx"
            with pd.ExcelWriter(design_path) as writer:
                pd.DataFrame({"Capa": ["texto"]}).to_excel(writer, sheet_name="Capa", index=False)
                SCENARIO_DESIGN.to_excel(writer, sheet_name="PROJETO PERFURAÇÃO", index=False)
            design = read_design_table(design_path, cfg["business"]["elevation_design_sheet_pattern"])
            self.assertEqual(design.columns.tolist(), ["ID", "X Collar", "Y Collar", "Z Collar"])
            self.assertEqual(len(design), 3)

            project = root / "projeto completo.csv"
            final = root / "configuração final.csv"
            project.write_text(
                "Number,UTM_X,UTM_Y,Length_m,Stemming_m,Diameter_mm,Subdrilling_m,Angle_deg,Azimuth_deg,Total_Charge_kg\n"
                "171,748776.29,8930000.78,8.4,2.8,102,0.6,15,342,78.1\n",
                encoding="utf-8",
            )
            final.write_text(
                "Number,X,Y,Z,X_Toe,Y_Toe,Z_Toe,Length,Stemming,Diameter,Subdrilling,Angle,Azimuth,DetonatingTime,InputedCharge\n"
                "171,748776.29,8930000.78,748775.62,748775.618,8930002.848,748767.506,8.4,2.9,0.102,0.6,15,342,10132,78.1\n",
                encoding="utf-8",
            )
            sources = SourceFiles(project=project, final=final, plan_pdf=None, histo_files=(), design=design_path)
            validate_sources(sources, cfg)

            broken = root / "Plano de Perfuração.xlsx"
            pd.DataFrame({"ID": [171], "X Collar": [748776.29]}).to_excel(broken, sheet_name="PROJETO PERFURAÇÃO", index=False)
            with self.assertRaisesRegex(ValueError, "Y Collar, Z Collar"):
                validate_sources(SourceFiles(project=project, final=final, plan_pdf=None, histo_files=(), design=broken), cfg)


if __name__ == "__main__":
    unittest.main()
