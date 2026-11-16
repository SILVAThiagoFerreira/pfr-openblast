"""Paridade entre a CLI Python (src/pfr/charge_distribution.py) e o site (public/charge.js).

Gera casos aleatórios determinísticos, executa a referência JavaScript via Node e compara valor a valor.
Se o Node não estiver instalado, o teste é pulado com aviso explícito (nunca falha por ausência de ferramenta).
"""

import json
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from pfr.charge_distribution import (  # noqa: E402
    ChargeDistributionError,
    distribute_charges,
    redistribute_zero_charges,
)

NODE = shutil.which("node")
SCRIPT = ROOT / "tests" / "parity" / "charge_parity_node.js"


def _random_values(rng: random.Random, count: int, with_none: bool) -> list:
    values = []
    for _ in range(count):
        draw = rng.random()
        if with_none and draw < 0.04:
            values.append(None)
        elif draw < 0.30:
            values.append(0.0)
        elif draw < 0.50:
            values.append(round(rng.uniform(0.5, 25.0), rng.choice([1, 2, 3])))
        elif draw < 0.70:
            values.append(rng.choice([22.999977, 7.999992, 128.2, 137.773, 60.0]))
        else:
            values.append(round(rng.uniform(18.0, 60.0), rng.choice([2, 3])))
    return values


def _zero_cases(seed: int, count: int) -> list:
    rng = random.Random(seed)
    cases = []
    for _ in range(count):
        values = _random_values(rng, rng.randint(3, 120), with_none=True)
        positive = [v for v in values if v not in (None, 0.0)]
        if positive:
            top = round(max(positive) + 1.0, 3)
            values[rng.randrange(len(values))] = top
            values[rng.randrange(len(values))] = top
        fixed = [rng.randrange(len(values))] if rng.random() < 0.3 else []
        cases.append({
            "mode": "zero",
            "values": values,
            "zeroMinimum": 0.01,
            "zeroStep": 0.001,
            "fixedIndexes": fixed,
        })
    return cases


def _distribution_cases(seed: int, count: int) -> list:
    rng = random.Random(seed)
    cases = []
    for _ in range(count):
        values = _random_values(rng, rng.randint(4, 150), with_none=False)
        values = [max(v, 0.0) for v in values]
        positive_idx = [i for i, v in enumerate(values) if v > 0]
        if len(positive_idx) < 4:
            continue
        maximum_value = round(rng.uniform(46.0, 60.0), 5)
        maximum_index = rng.choice(positive_idx)
        values[maximum_index] = maximum_value
        maximum_indexes = [i for i, v in enumerate(values) if v == maximum_value]
        candidates = [i for i in positive_idx if i not in maximum_indexes and values[i] >= 15.0]
        if not candidates:
            continue
        minimum_index = rng.choice(candidates)
        minimum_value = round(rng.uniform(15.0, 24.0), 2)
        fixed_pool = [i for i in range(len(values)) if i not in (minimum_index, *maximum_indexes)]
        fixed = [rng.choice(fixed_pool)] if rng.random() < 0.25 and fixed_pool else []
        free = [i for i in range(len(values)) if i != minimum_index and i not in maximum_indexes and i not in fixed]
        lower = minimum_value * (len(free) + 1) + maximum_value * len(maximum_indexes)
        upper = maximum_value * (len(free) + len(maximum_indexes) + 1)
        target = round(lower + (upper - lower) * rng.uniform(0.02, 0.6), 4)
        cases.append({
            "mode": "dist",
            "values": values,
            "target": target,
            "stepKg": 5.0,
            "minimumIndex": minimum_index,
            "minimumValue": minimum_value,
            "maximumIndex": maximum_index,
            "maximumValue": maximum_value,
            "maximumIndexes": maximum_indexes,
            "fixedIndexes": fixed,
        })
    return cases


def _run_reference(cases: list) -> list:
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "cases.json"
        path.write_text(json.dumps(cases), encoding="utf-8")
        completed = subprocess.run(
            [NODE, str(SCRIPT), str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=600,
            check=True,
        )
    return json.loads(completed.stdout)


def _python_result(case: dict) -> dict:
    notes: list = []
    try:
        if case["mode"] == "zero":
            out = redistribute_zero_charges(
                case["values"],
                enabled=True,
                zero_minimum=case["zeroMinimum"],
                zero_step_kg=case["zeroStep"],
                fixed_indexes=case["fixedIndexes"],
                notes=notes,
            )
        else:
            out = distribute_charges(
                case["values"],
                case["target"],
                step_kg=case["stepKg"],
                minimum_index=case["minimumIndex"],
                minimum_value=case["minimumValue"],
                maximum_index=case["maximumIndex"],
                maximum_value=case["maximumValue"],
                maximum_indexes=case["maximumIndexes"],
                fixed_indexes=case["fixedIndexes"],
                notes=notes,
            )
        return {"ok": True, "out": out, "notes": notes}
    except ChargeDistributionError as error:
        return {"ok": False, "error": str(error)}


@unittest.skipIf(NODE is None, "Node.js não encontrado: paridade com o site não verificada")
class ChargeParityTest(unittest.TestCase):
    def _compare(self, cases: list) -> None:
        reference = _run_reference(cases)
        self.assertEqual(len(reference), len(cases))
        mismatches = []
        for case, expected in zip(cases, reference):
            actual = _python_result(case)
            if expected["ok"] != actual["ok"]:
                mismatches.append((case["mode"], expected, actual))
                continue
            if expected["ok"] and (expected["out"] != actual["out"] or expected["notes"] != actual["notes"]):
                mismatches.append((case["mode"], expected["out"][:5], actual["out"][:5]))
        self.assertEqual(mismatches[:3], [], f"{len(mismatches)} divergências com o site")

    def test_zero_redistribution_matches_site(self):
        self._compare(_zero_cases(seed=20260917, count=400))

    def test_distribution_matches_site(self):
        self._compare(_distribution_cases(seed=20260918, count=400))


class ChargeInvariantTest(unittest.TestCase):
    def test_zero_redistribution_keeps_total_and_distinct_loads(self):
        rng = random.Random(77)
        for _ in range(200):
            values = _random_values(rng, rng.randint(4, 90), with_none=True)
            if not any(v not in (None, 0.0) for v in values):
                continue
            try:
                out = redistribute_zero_charges(
                    values, enabled=True, zero_minimum=0.01, zero_step_kg=0.001, fixed_indexes=[], notes=[]
                )
            except ChargeDistributionError:
                continue
            self.assertEqual(
                round(sum(v for v in out if v is not None) * 1e6),
                round(sum(v for v in values if v is not None) * 1e6),
            )
            positives = [v for v in out if v is not None]
            highest = max(positives)
            non_maximum = [v for v in positives if v != highest]
            self.assertEqual(len(non_maximum), len(set(non_maximum)), "carga repetida fora do máximo preservado")


if __name__ == "__main__":
    unittest.main()
