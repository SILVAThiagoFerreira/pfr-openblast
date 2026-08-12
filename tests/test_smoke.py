import unittest
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from pfr.config import load_config, normalize_config  # noqa: E402
from pfr.discovery import discover_sources  # noqa: E402


class SmokeTest(unittest.TestCase):
    def test_discovery(self):
        cfg = normalize_config(load_config(ROOT / "config.yaml"), ROOT)
        sources = discover_sources(cfg)
        self.assertTrue(sources.project.exists())
        self.assertTrue(sources.final.exists())

    def test_discovery_falls_back_to_standard_histo_log_name(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_root = root / "input"
            input_root.mkdir()
            (input_root / "projeto completo.csv").write_text("Number\n1\n", encoding="utf-8")
            (input_root / "config final.csv").write_text("Number\n1\n", encoding="utf-8")
            histo = input_root / "bm-0322110826-1408_histo.log"
            histo.write_text("[HistoryEnd]\n", encoding="utf-8")
            cfg = normalize_config(
                {
                    "paths": {"project_root": str(root), "input_root": str(input_root)},
                    "inputs": {
                        "pp": {
                            "project_patterns": ["*projeto completo*.csv"],
                            "final_patterns": ["*config final*.csv"],
                            "plan_pdf_patterns": [],
                            "histo_patterns": ["HISTO-*.txt"],
                        }
                    },
                },
                root,
            )

            sources = discover_sources(cfg)

        self.assertEqual(sources.histo_files, (histo,))


if __name__ == "__main__":
    unittest.main()
