import unittest
from pathlib import Path
import sys

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


if __name__ == "__main__":
    unittest.main()
