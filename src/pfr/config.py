from copy import deepcopy
from pathlib import Path

import yaml


def load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def resolve_path(base: Path, value: str | Path | None) -> Path | None:
    if value is None:
        return None
    candidate = Path(value)
    return candidate if candidate.is_absolute() else (base / candidate).resolve()


def normalize_config(raw: dict, root: Path) -> dict:
    cfg = deepcopy(raw)
    cfg.setdefault("paths", {})
    cfg.setdefault("inputs", {})
    cfg.setdefault("business", {})
    cfg.setdefault("validation", {})
    cfg.setdefault("export", {})
    cfg.setdefault("logging", {})

    # O Config Final e a fonte autoritativa dos furos realizados. O campo
    # `eliminated` do Projeto Completo continua disponivel para auditoria,
    # mas nao pode remover silenciosamente um furo que exista no realizado.
    cfg["business"].setdefault("include_eliminated", True)

    cfg["paths"]["project_root"] = resolve_path(root, cfg["paths"].get("project_root", "."))
    for key in ("input_root", "output_root", "backup_root", "log_root"):
        cfg["paths"][key] = resolve_path(cfg["paths"]["project_root"], cfg["paths"].get(key))

    return cfg
