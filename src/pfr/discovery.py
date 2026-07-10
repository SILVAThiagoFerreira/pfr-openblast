from pathlib import Path
from fnmatch import fnmatch

from .models import SourceFiles


def find_first(root: Path, patterns: list[str]) -> Path | None:
    entries = [path for path in root.iterdir() if path.is_file()]
    for pattern in patterns:
        matches = sorted(
            [path for path in entries if fnmatch(path.name.lower(), pattern.lower())],
            key=lambda path: path.name.lower(),
        )
        if matches:
            return matches[0]
    return None


def discover_sources(cfg: dict) -> SourceFiles:
    input_root = cfg["paths"]["input_root"]
    pp = cfg["inputs"]["pp"]
    project = find_first(input_root, pp["project_patterns"])
    final = find_first(input_root, pp["final_patterns"])
    plan_pdf = find_first(input_root, pp["plan_pdf_patterns"])
    histo_files = tuple(sorted({p for pattern in pp["histo_patterns"] for p in input_root.iterdir() if p.is_file() and fnmatch(p.name.lower(), pattern.lower())}))
    if project is None or final is None:
        raise FileNotFoundError("Arquivos PP obrigatorios nao encontrados")
    return SourceFiles(project=project, final=final, plan_pdf=plan_pdf, histo_files=histo_files)
