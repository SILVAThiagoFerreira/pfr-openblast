"""Furo de assinatura (SPEC.md, "Furo de assinatura"): o furo indicado mantém os valores de entrada e os
demais furos seguem as regras atuais. Cobre validação, carga, tampão, tempo, diâmetro, cota e a CLI."""

import copy
import logging
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from pfr.config import load_config, normalize_config  # noqa: E402
from pfr.elevation import resolve_elevations  # noqa: E402
from pfr.pipeline import run  # noqa: E402
from pfr.processing import build_output_frame  # noqa: E402
from pfr.validation import parse_signature_hole_id, validate_signature_hole  # noqa: E402


def _cfg(signature_hole_id="") -> dict:
    cfg = normalize_config(load_config(ROOT / "config.yaml"), ROOT)
    cfg["business"]["signature_hole_id"] = signature_hole_id
    cfg["business"]["enforce_charge_total_target"] = True
    cfg["business"]["charge_total_target_kg"] = 100.0
    cfg["business"]["charge_zero_fill_min_kg"] = 0.5
    return cfg


def _merged(**overrides) -> pd.DataFrame:
    data = {
        "Number": [1, 2, 3, 4, 5],
        "X": [10.0, 11.0, 12.0, 13.0, 14.0],
        "Y": [20.0, 21.0, 22.0, 23.0, 24.0],
        "Z": [30.0, 31.0, 32.0, 33.0, 34.0],
        "Z_Toe": [29.0, 30.0, 31.0, 32.0, 33.0],
        "p_length": [9.0, 9.0, 9.0, 9.0, 9.0],
        "r_length": [9.0, 9.0, 9.0, 9.0, 9.0],
        "p_stemming": [3.0, 3.0, 3.0, 3.0, 3.0],
        "r_stemming": [3.0, 3.0, 3.04, 3.0, 3.0],
        "p_subdrilling": [0.6, 0.6, 0.6, 0.6, 0.6],
        "r_subdrilling": [0.6, 0.6, 0.6, 0.6, 0.6],
        "r_azimuth": [0.0, 0.0, 0.0, 0.0, 0.0],
        "r_angle": [0.0, 0.0, 0.0, 0.0, 0.0],
        "p_explosive": [10.0, 10.0, 10.0, 10.0, 10.0],
        "r_explosive": [5.0, 0.0, 7.5, 20.0, 60.0],
        "Diameter_m": [0.127, 0.127, 0.127, 0.127, 0.127],
        "DetonatingTime": [1000.0, np.nan, 1050.0, np.nan, 1300.0],
    }
    data.update(overrides)
    return pd.DataFrame(data)


class SignatureHoleTest(unittest.TestCase):
    def test_signature_hole_keeps_input_values_while_other_holes_follow_the_rules(self):
        cfg = _cfg("3")
        merged = _merged()
        mask = validate_signature_hole(merged, cfg)
        merged, _ = resolve_elevations(merged, None, cfg, preserved=mask)

        data = build_output_frame(merged, "1234567", "30/04/2026", "06:04:41", cfg, signature_mask=mask)
        hole = data[data["id"] == 3].iloc[0]
        others = data[data["id"] != 3]

        # Furo de assinatura: valores de entrada, sem nenhuma regra automática.
        self.assertEqual(hole["cargas realizadas"], 7.5)
        self.assertEqual(hole["tampao realizado"], 3.04)
        self.assertEqual(hole["tempo detonacao (ms)"], 1050)
        self.assertEqual(hole["diametro"], 0.127)
        self.assertEqual(hole["Z (crest)"], 32.0)
        self.assertEqual(hole["Z (toe)"], 31.0)

        # Demais furos: as regras atuais continuam valendo.
        self.assertEqual(others["tempo detonacao (ms)"].tolist(), [1000, 1025, 1175, 1300])
        self.assertTrue(all(value in (2.9, 3.0, 3.1) for value in others["tampao realizado"]))
        self.assertTrue(np.allclose(others["diametro"].astype(float), 5.0))
        self.assertAlmostEqual(float(data["cargas realizadas"].sum()), 100.0, places=3)
        self.assertEqual(data.loc[data["id"] == 5, "cargas realizadas"].iloc[0], 60.0)
        self.assertTrue(merged.attrs["signature_hole_count"] == 1)

    def test_signature_hole_with_zero_charge_stays_zero_and_is_not_funded(self):
        cfg = _cfg("2")
        merged = _merged(DetonatingTime=[1000.0, 1025.0, 1050.0, np.nan, 1300.0])
        mask = validate_signature_hole(merged, cfg)
        data = build_output_frame(merged, "1234567", "30/04/2026", "06:04:41", cfg, signature_mask=mask)

        self.assertEqual(data.loc[data["id"] == 2, "cargas realizadas"].iloc[0], 0.0)
        self.assertAlmostEqual(float(data["cargas realizadas"].sum()), 100.0, places=3)

    def test_signature_hole_with_unknown_id_raises_explicit_error(self):
        with self.assertRaisesRegex(ValueError, "furo de assinatura 99 não foi encontrado"):
            validate_signature_hole(_merged(), _cfg("99"))

    def test_signature_hole_with_duplicated_id_raises_explicit_error(self):
        merged = _merged(Number=[1, 3, 3, 4, 5])
        with self.assertRaisesRegex(ValueError, "aparece mais de uma vez"):
            validate_signature_hole(merged, _cfg("3"))

    def test_signature_hole_with_invalid_format_raises_explicit_error(self):
        with self.assertRaisesRegex(ValueError, "deve ser o número do furo"):
            validate_signature_hole(_merged(), _cfg("A1"))
        self.assertIsNone(parse_signature_hole_id(""))
        self.assertIsNone(parse_signature_hole_id(None))
        self.assertEqual(parse_signature_hole_id(245), 245)

    def test_signature_hole_without_valid_time_raises_because_time_cannot_be_imputed(self):
        merged = _merged(DetonatingTime=[1000.0, np.nan, np.nan, np.nan, 1300.0])
        with self.assertRaisesRegex(ValueError, "tempo de detonação válido"):
            validate_signature_hole(merged, _cfg("3"))

    def test_signature_hole_with_time_repeated_in_another_hole_raises(self):
        merged = _merged(DetonatingTime=[1000.0, 1050.0, 1050.0, np.nan, 1300.0])
        with self.assertRaisesRegex(ValueError, "tempo de detonação válido"):
            validate_signature_hole(merged, _cfg("3"))

    def test_without_signature_hole_output_is_identical_to_previous_behaviour(self):
        base = _cfg("")
        without_key = copy.deepcopy(base)
        without_key["business"].pop("signature_hole_id")
        expected = build_output_frame(_merged(), "1234567", "30/04/2026", "06:04:41", without_key)
        actual = build_output_frame(_merged(), "1234567", "30/04/2026", "06:04:41", base)
        pd.testing.assert_frame_equal(actual, expected)
        # Regras atuais sem furo de assinatura: diâmetro convertido, tempos imputados e total fechado no alvo.
        self.assertTrue(np.allclose(actual["diametro"].astype(float), 5.0))
        self.assertEqual(actual["tempo detonacao (ms)"].tolist(), [1000, 1025, 1050, 1175, 1300])
        self.assertAlmostEqual(float(actual["cargas realizadas"].sum()), 100.0, places=3)

    def test_signature_hole_elevation_uses_config_final_values_as_they_came(self):
        cfg = _cfg("171")
        merged = pd.DataFrame({
            "Number": [171, 172],
            "X": [748776.29, 748774.81],
            "Y": [8930000.78, 8929998.76],
            "Z": [748775.62, 287.5],
            "Z_Toe": [748767.506, 279.5],
            "r_length": [8.4, 8.0],
            "r_angle": [15.0, 0.0],
            "DetonatingTime": [1000.0, 1050.0],
        })
        design = pd.DataFrame(
            {"ID": [171, 172], "X Collar": [748776.29, 748774.81], "Y Collar": [8930000.78, 8929998.76], "Z Collar": [287.63, 287.5]}
        )
        mask = validate_signature_hole(merged, cfg)
        resolved, warnings = resolve_elevations(merged, design, cfg, preserved=mask)

        self.assertEqual(resolved.loc[0, "Z"], 748775.62, "Z do furo de assinatura como veio, sem usar o plano")
        self.assertEqual(resolved.loc[0, "Z_Toe"], 748767.506)
        self.assertEqual(resolved.loc[1, "Z"], 287.5, "demais furos seguem a regra de cota")
        joined = "\n".join(warnings)
        self.assertIn("Furo de assinatura 171: Z (crest) = 748775,62 mantido como veio do Config Final", joined)
        self.assertNotIn("Sem cota (Z) válida", joined)

    def test_pipeline_end_to_end_preserves_signature_hole_in_excel(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_root = root / "input"
            input_root.mkdir()
            (input_root / "projeto completo.csv").write_text(
                "Number,UTM_X,UTM_Y,Length_m,Stemming_m,Diameter_mm,Subdrilling_m,Angle_deg,Azimuth_deg,Total_Charge_kg,eliminated\n"
                "1,10,20,9,3,127,0.6,0,0,10,0\n"
                "2,11,21,9,3,127,0.6,0,0,10,0\n"
                "3,12,22,9,3,127,0.6,0,0,10,0\n"
                "4,13,23,9,3,127,0.6,0,0,10,0\n"
                "5,14,24,9,3,127,0.6,0,0,10,0\n",
                encoding="utf-8",
            )
            (input_root / "config final.csv").write_text(
                "Number,X,Y,Z,X_Toe,Y_Toe,Z_Toe,Length,Stemming,Diameter,Subdrilling,Angle,Azimuth,DetonatingTime,InputedCharge\n"
                "1,10,20,30,10,20,29,9,3.0,0.127,0.6,0,0,1000,5\n"
                "2,11,21,31,11,21,30,9,3.0,0.127,0.6,0,0,-1,0\n"
                "3,12,22,32,12,22,31,9,3.04,0.127,0.6,0,0,1050,7.5\n"
                "4,13,23,33,13,23,32,9,3.0,0.127,0.6,0,0,,20\n"
                "5,14,24,34,14,24,33,9,3.0,0.127,0.6,0,0,1300,60\n",
                encoding="utf-8",
            )
            (input_root / "HISTO-TESTE.txt").write_text("[Fire]2026/07/10-12:00:00\nBMO\n-\n", encoding="utf-8")

            raw = load_config(ROOT / "config.yaml")
            raw["paths"] = {
                "project_root": str(root),
                "input_root": str(input_root),
                "output_root": str(root / "output"),
                "backup_root": str(root / "backup"),
                "log_root": str(root / "logs"),
            }
            raw["business"]["plan_id_source"] = "fallback"
            raw["business"]["fallback_plan_id"] = "440726"
            raw["business"]["signature_hole_id"] = "3"
            raw["business"]["enforce_charge_total_target"] = False
            raw["business"]["charge_total_target_kg"] = 100.0
            raw["business"]["redistribute_zero_charges"] = False
            config_path = root / "config_teste.yaml"
            config_path.write_text(yaml.safe_dump(raw, allow_unicode=True, sort_keys=False), encoding="utf-8")

            try:
                result = run(config_path)
                output = pd.read_excel(result.output_path, sheet_name="Dados dos Furos")
            finally:
                for handler in list(logging.getLogger().handlers):
                    if isinstance(handler, logging.FileHandler):
                        handler.close()
                        logging.getLogger().removeHandler(handler)

        hole = output[output["id"] == 3].iloc[0]
        self.assertEqual(hole["cargas realizadas"], 7.5)
        self.assertEqual(hole["tampao realizado"], 3.04)
        self.assertEqual(hole["tempo detonacao (ms)"], 1050)
        self.assertEqual(hole["diametro"], 0.127)
        self.assertEqual(hole["Z (crest)"], 32.0)
        self.assertEqual(hole["Z (toe)"], 31.0)
        others = output[output["id"] != 3]
        # Demais furos: tempo inválido (-1 e vazio) imputado pela sequência; diâmetro convertido para polegadas.
        self.assertEqual(others["tempo detonacao (ms)"].tolist(), [1000, 1025, 1175, 1300])
        self.assertTrue(np.allclose(others["diametro"].astype(float), 5.0))
        self.assertEqual(len(output), 5)


if __name__ == "__main__":
    unittest.main()
