import io
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from pfr.models import RunResult  # noqa: E402
from pfr.web import create_app  # noqa: E402


class WebTest(unittest.TestCase):
    def test_duplicate_upload_names_are_rejected_without_overwriting(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "config.yaml"
            config.write_text("paths: {}\n", encoding="utf-8")
            app = create_app(root, config)
            response = app.test_client().post(
                "/api/generate",
                data={"inputs": [(io.BytesIO(b"a"), "same.csv"), (io.BytesIO(b"b"), "same.csv")]},
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("duplicado", response.get_json()["error"])

    def test_generate_returns_downloadable_result(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "config.yaml"
            config.write_text("paths: {}\n", encoding="utf-8")
            app = create_app(root, config)
            def fake_run(config_path):
                output = Path(config_path).parent / "output" / "output.xlsx"
                output.write_bytes(b"PK-test")
                return RunResult(output, "123", "01/01/2026", "12:00:00", 1, 2.0, 2.0, 1.0)

            with patch("pfr.web.run", side_effect=fake_run):
                response = app.test_client().post(
                    "/api/generate",
                    data={"inputs": (io.BytesIO(b"a"), "input.csv")},
                    content_type="multipart/form-data",
                )
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertEqual(app.test_client().get(payload["download_url"]).status_code, 200)

    def test_health_endpoint_is_json(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "config.yaml"
            config.write_text("paths: {}\n", encoding="utf-8")
            response = create_app(root, config).test_client().get("/api/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["status"], "ok")

    def test_generation_error_keeps_txt_log_available(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "config.yaml"
            config.write_text("paths: {}\n", encoding="utf-8")
            app = create_app(root, config)
            with patch("pfr.web.run", side_effect=ValueError("falha de validação")):
                response = app.test_client().post(
                    "/api/generate",
                    data={"inputs": (io.BytesIO(b"a"), "input.csv")},
                    content_type="multipart/form-data",
                )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            log_response = app.test_client().get(payload["log_url"])
            self.assertEqual(log_response.status_code, 200)
            self.assertIn("falha de validação", log_response.data.decode("utf-8"))
            log_response.close()
