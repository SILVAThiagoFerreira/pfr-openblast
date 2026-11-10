"""Furo de assinatura (SPEC.md, "Furo de assinatura").

Sentido da regra: nenhuma regra de ajuste de valor (carga, carga-alvo, variação de tampão, imputação de tempo,
substituição ou cálculo de cota) altera os valores do furo. Conversões, arredondamentos e formatação seguem a
regra normal dos demais furos (ex.: diâmetro 0,127 m sai em polegadas, 5).
"""

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
from pfr.processing import _apply_stemming_variation, build_output_frame  # noqa: E402
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
        "r_stemming": [3.0, 3.0, 3.1, 3.0, 3.0],
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


def _build(merged: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    mask = validate_signature_hole(merged, cfg)
    return build_output_frame(merged, "1234567", "30/04/2026", "06:04:41", cfg, signature_mask=mask)


class SignatureHoleTest(unittest.TestCase):
    def test_hole_charge_and_stemming_are_not_adjusted_by_value_rules(self):
        cfg = _cfg("3")
        merged = _merged()
        mask = validate_signature_hole(merged, cfg)
        merged, _ = resolve_elevations(merged, None, cfg, preserved=mask)
        data = build_output_frame(merged, "1234567", "30/04/2026", "06:04:41", cfg, signature_mask=mask)
        hole = data[data["id"] == 3].iloc[0]
        others = data[data["id"] != 3]

        # Carga e tampão do furo iguais à entrada: nenhuma redistribuição, carga-alvo ou variação.
        self.assertEqual(hole["cargas realizadas"], 7.5)
        self.assertEqual(hole["tampao realizado"], 3.1)
        # Os demais furos seguem as regras atuais (fechamento do total e variação de tampão).
        self.assertAlmostEqual(float(others["cargas realizadas"].sum()), 100.0 - 7.5, places=3)
        self.assertTrue(all(value in (2.9, 3.0, 3.1) for value in others["tampao realizado"]))
        self.assertEqual(data.loc[data["id"] == 5, "cargas realizadas"].iloc[0], 60.0)
        self.assertEqual(merged.attrs["signature_hole_count"], 1)

    def test_hole_diameter_is_converted_to_inches_like_other_holes(self):
        cfg = _cfg("3")
        data = _build(_merged(), cfg)

        # 0,127 m é convertido para polegadas (5), como nos demais furos: a conversão é formato, não ajuste de valor.
        self.assertEqual(data.loc[data["id"] == 3, "diametro"].iloc[0], 5.0)
        self.assertTrue(np.allclose(data["diametro"].astype(float), 5.0))

    def test_hole_stemming_gets_one_decimal_rounding_but_no_variation(self):
        cfg = _cfg("3")
        merged = _merged(r_stemming=[3.0, 3.0, 3.04, 3.0, 3.0])
        data = _build(merged, cfg)

        # Formato normal (uma casa decimal), sem variação simulada.
        self.assertEqual(data.loc[data["id"] == 3, "tampao realizado"].iloc[0], 3.0)

    def test_stemming_variation_skips_the_hole_and_keeps_its_input(self):
        values = pd.Series([3.04, 3.0, 3.0])
        numbers = pd.Series([3, 4, 5])
        preserved = pd.Series([True, False, False])
        varied, count = _apply_stemming_variation(values, numbers, "1234567", True, 0.12, preserved)

        self.assertEqual(varied.iloc[0], 3.04)
        self.assertEqual(count, 2)
        self.assertTrue(all(2.88 <= value <= 3.12 for value in varied.iloc[1:]))

    def test_hole_time_follows_normal_rounding_and_is_not_imputed(self):
        cfg = _cfg("3")
        merged = _merged(DetonatingTime=[1000.0, np.nan, 1049.6, np.nan, 1300.0])
        data = _build(merged, cfg)

        self.assertEqual(data.loc[data["id"] == 3, "tempo detonacao (ms)"].iloc[0], 1050)
        self.assertEqual(data["tempo detonacao (ms)"].tolist(), [1000, 1025, 1050, 1175, 1300])

    def test_later_duplicate_time_is_imputed_for_the_other_hole(self):
        cfg = _cfg("3")
        merged = _merged(DetonatingTime=[1000.0, np.nan, 1050.0, 1050.0, 1300.0])
        data = _build(merged, cfg)

        # O furo de assinatura é a primeira ocorrência de 1050; o furo posterior com o mesmo tempo é imputado.
        self.assertEqual(data["tempo detonacao (ms)"].tolist(), [1000, 1025, 1050, 1175, 1300])

    def test_hole_time_repeated_from_an_earlier_hole_raises(self):
        merged = _merged(DetonatingTime=[1000.0, 1050.0, 1050.0, np.nan, 1300.0])
        with self.assertRaisesRegex(ValueError, "tempo de detonação válido"):
            validate_signature_hole(merged, _cfg("3"))

    def test_hole_time_missing_or_negative_raises_because_it_cannot_be_imputed(self):
        for times in ([1000.0, np.nan, np.nan, np.nan, 1300.0], [1000.0, np.nan, -1.0, np.nan, 1300.0]):
            with self.subTest(times=times):
                with self.assertRaisesRegex(ValueError, "tempo de detonação válido"):
                    validate_signature_hole(_merged(DetonatingTime=times), _cfg("3"))

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

    def test_hole_with_zero_charge_stays_zero_and_is_not_funded(self):
        cfg = _cfg("2")
        merged = _merged(DetonatingTime=[1000.0, 1025.0, 1050.0, np.nan, 1300.0])
        data = _build(merged, cfg)

        self.assertEqual(data.loc[data["id"] == 2, "cargas realizadas"].iloc[0], 0.0)
        self.assertAlmostEqual(float(data["cargas realizadas"].sum()), 100.0, places=3)

    def test_without_signature_hole_output_is_identical_to_previous_behaviour(self):
        base = _cfg("")
        without_key = copy.deepcopy(base)
        without_key["business"].pop("signature_hole_id")
        expected = build_output_frame(_merged(), "1234567", "30/04/2026", "06:04:41", without_key)
        actual = build_output_frame(_merged(), "1234567", "30/04/2026", "06:04:41", base)
        pd.testing.assert_frame_equal(actual, expected)
        self.assertTrue(np.allclose(actual["diametro"].astype(float), 5.0))
        self.assertEqual(actual["tempo detonacao (ms)"].tolist(), [1000, 1025, 1050, 1175, 1300])
        self.assertAlmostEqual(float(actual["cargas realizadas"].sum()), 100.0, places=3)

    def test_hole_cota_is_not_replaced_by_the_plan_nor_computed(self):
        cfg = _cfg("171")
        merged = pd.DataFrame({
            "Number": [171],
            "X": [748776.29],
            "Y": [8930000.78],
            "Z": [748775.62],
            "Z_Toe": [748767.506],
            "r_length": [8.4],
            "r_angle": [15.0],
            "DetonatingTime": [1000.0],
        })
        design = pd.DataFrame({"ID": [171], "X Collar": [748776.29], "Y Collar": [8930000.78], "Z Collar": [287.63]})
        mask = validate_signature_hole(merged, cfg)
        resolved, warnings = resolve_elevations(merged, design, cfg, preserved=mask)

        # Z fora da faixa de cota: não é substituído pelo Z Collar do plano e o Z (toe) não é calculado.
        self.assertTrue(pd.isna(resolved.loc[0, "Z"]))
        self.assertTrue(pd.isna(resolved.loc[0, "Z_Toe"]))
        joined = "\n".join(warnings)
        self.assertIn("Furo de assinatura 171", joined)
        self.assertIn("não é cota", joined)
        self.assertIn("não há substituição pelo Plano de Perfuração", joined)
        self.assertNotIn("obtido do Plano de Perfuração", joined)

    def test_hole_toe_is_not_computed_while_other_holes_still_compute_it(self):
        cfg = _cfg("172")
        merged = pd.DataFrame({
            "Number": [171, 172],
            "X": [748776.29, 748774.81],
            "Y": [8930000.78, 8929998.76],
            "Z": [287.5, 287.5],
            "Z_Toe": [748767.506, 748766.81],
            "r_length": [8.0, 8.0],
            "r_angle": [0.0, 0.0],
            "DetonatingTime": [1000.0, 1050.0],
        })
        mask = validate_signature_hole(merged, cfg)
        resolved, warnings = resolve_elevations(merged, None, cfg, preserved=mask)

        # O furo de assinatura (172) não tem Z (toe) calculado; o furo 171 segue a regra normal.
        self.assertTrue(pd.isna(resolved.loc[1, "Z_Toe"]))
        self.assertAlmostEqual(float(resolved.loc[0, "Z_Toe"]), 279.5, places=6)
        self.assertIn("Furo de assinatura 172: o Z_Toe do Config Final não é cota", "\n".join(warnings))

    def test_pipeline_end_to_end_applies_the_rule_in_the_excel_output(self):
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
                "3,12,22,32,12,22,31,9,3.1,0.127,0.6,0,0,1050,7.5\n"
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
        self.assertEqual(hole["tampao realizado"], 3.1)
        self.assertEqual(hole["tempo detonacao (ms)"], 1050)
        self.assertEqual(hole["diametro"], 5.0)
        self.assertEqual(hole["Z (crest)"], 32.0)
        self.assertEqual(hole["Z (toe)"], 31.0)
        others = output[output["id"] != 3]
        self.assertEqual(others["tempo detonacao (ms)"].tolist(), [1000, 1025, 1175, 1300])
        self.assertTrue(np.allclose(others["diametro"].astype(float), 5.0))
        self.assertEqual(len(output), 5)


if __name__ == "__main__":
    unittest.main()
