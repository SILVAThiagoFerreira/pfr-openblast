"""Garante que os limites do ajuste do BREX são os mesmos no config.yaml e no site."""

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]

# chave do config.yaml -> chave do window.PFR_BROWSER_CONFIG.business em public/config.js
BREX_KEYS = {
    "brex_offset_hours": "brexOffsetHours",
    "brex_offset_min_hours": "brexOffsetMinHours",
    "brex_offset_max_hours": "brexOffsetMaxHours",
}


def test_brex_offset_settings_match_browser_config():
    business = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))["business"]
    browser_config = (ROOT / "public" / "config.js").read_text(encoding="utf-8")

    for yaml_key, js_key in BREX_KEYS.items():
        assert isinstance(business.get(yaml_key), int), f"config.yaml business.{yaml_key} deve ser inteiro"
        match = re.search(rf"\b{js_key}:\s*(-?\d+)", browser_config)
        assert match, f"public/config.js deve definir {js_key}"
        assert int(match.group(1)) == business[yaml_key], f"{js_key} diverge de business.{yaml_key}"

    assert business["brex_offset_min_hours"] <= business["brex_offset_hours"] <= business["brex_offset_max_hours"]
