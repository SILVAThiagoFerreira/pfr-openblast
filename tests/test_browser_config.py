"""Garante que a identificação do plano e os nomes de arquivo são iguais no config.yaml e no site."""

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]

# chave do config.yaml business -> chave do window.PFR_BROWSER_CONFIG.business em public/config.js
SCALAR_KEYS = {
    "plan_label_fallback_prefix": "planLabelFallbackPrefix",
    "plan_label_max_length": "planLabelMaxLength",
    "output_name_template": "outputNameTemplate",
    "output_name_text_template": "outputNameTextTemplate",
    # Cota (Z) do realizado: limites da faixa de cota, tolerância X/Y e aba do plano de perfuração.
    "elevation_plausible_min_m": "elevationPlausibleMinM",
    "elevation_plausible_max_m": "elevationPlausibleMaxM",
    "elevation_design_match_tolerance_m": "elevationDesignMatchToleranceM",
    "elevation_design_sheet_pattern": "elevationDesignSheetPattern",
}
LIST_KEYS = {
    "plan_label_generic_names": "planLabelGenericNames",
}


def _js_scalar(source: str, js_key: str):
    string_match = re.search(rf"\b{js_key}:\s*'([^']*)'", source)
    if string_match:
        return string_match.group(1)
    number_match = re.search(rf"\b{js_key}:\s*(-?\d+(?:\.\d+)?)\b", source)
    assert number_match, f"public/config.js deve definir {js_key}"
    text = number_match.group(1)
    return float(text) if "." in text else int(text)


def _js_list(source: str, js_key: str) -> list[str]:
    block = re.search(rf"\b{js_key}:\s*\[(.*?)\]", source, re.S)
    assert block, f"public/config.js deve definir {js_key}"
    return re.findall(r"'([^']*)'", block.group(1))


def test_plan_label_settings_match_browser_config():
    business = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))["business"]
    browser_config = (ROOT / "public" / "config.js").read_text(encoding="utf-8")

    for yaml_key, js_key in SCALAR_KEYS.items():
        assert yaml_key in business, f"config.yaml business.{yaml_key} é obrigatório"
        assert _js_scalar(browser_config, js_key) == business[yaml_key], f"{js_key} diverge de business.{yaml_key}"

    for yaml_key, js_key in LIST_KEYS.items():
        assert isinstance(business.get(yaml_key), list) and business[yaml_key], f"config.yaml business.{yaml_key} deve ser lista"
        assert _js_list(browser_config, js_key) == business[yaml_key], f"{js_key} diverge de business.{yaml_key}"

    assert 8 <= business["plan_label_max_length"] <= 120
    assert re.fullmatch(r"[A-Za-z0-9]{1,16}", business["plan_label_fallback_prefix"])
    assert "{plan_id}" in business["output_name_template"]
    assert "{plan_label}" in business["output_name_text_template"]
