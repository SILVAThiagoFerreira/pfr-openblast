from pathlib import Path
import argparse
import sys

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from pfr.pipeline import run  # noqa: E402
from pfr.web import create_app  # noqa: E402


def create_web_app():
    return create_app(ROOT, ROOT / "config.yaml")


def main() -> int:
    parser = argparse.ArgumentParser(description="PFR - Plano de Fogo Realizado")
    parser.add_argument("--config", default="config.yaml", help="Arquivo de configuracao")
    parser.add_argument("--web", action="store_true", help="Inicia a interface web")
    parser.add_argument("--host", default="127.0.0.1", help="Host da interface web")
    parser.add_argument("--port", type=int, default=5000, help="Porta da interface web")
    args = parser.parse_args()
    if args.web:
        create_app(ROOT, ROOT / args.config).run(host=args.host, port=args.port, debug=False)
        return 0
    result = run(ROOT / args.config)
    print()
    print("=" * 50)
    print(f"  Total emulsao gerado: {result.total_emulsion_kg:.2f} kg")
    print(f"  Carga max por espera: {result.max_charge_per_delay_kg:.2f} kg (delay {result.max_charge_delay_ms:.0f} ms)")
    print("=" * 50)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
