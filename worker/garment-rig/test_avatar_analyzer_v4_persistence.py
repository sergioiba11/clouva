
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time
import unittest

import app_v18


class AvatarAnalyzerV4PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.previous_root = app_v18.v32.RUN_CACHE_ROOT
        app_v18.v32.RUN_CACHE_ROOT = self.root / "runs"
        app_v18.v32.RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        app_v18.v32.RUN_CACHE_ROOT = self.previous_root
        self.temp.cleanup()

    def _fixture(self, run_id="a" * 32, debug_size=2_000_000):
        output = self.root / "output"
        output.mkdir(parents=True, exist_ok=True)
        analysis = {
            "version": app_v18.ANALYZER_VERSION,
            "mapVersion": app_v18.MAP_VERSION,
            "runId": run_id,
            "overall_status": "needs_review",
            "source": {"sha256": "source"},
            "landmarks": {"pelvis": {"accepted": True, "state": "verified"}},
            "metrics": {"verifiedLandmarkCount": 1},
            "diagnostics": {
                "initialAttempt": {"stdout": "x" * debug_size},
                "finalAttempt": {"stderr": "y" * debug_size},
                "kept": {"value": 1},
            },
        }
        (output / "avatar_analysis.json").write_text(json.dumps(analysis), encoding="utf-8")
        (output / "diagnostic_report.json").write_text(json.dumps({"debug": {"stdout": "z" * debug_size}}), encoding="utf-8")
        (output / "diagnostic_landmarks.glb").write_bytes(b"glTF" + b"0" * 4096)
        renders = output / "renders_v4"
        renders.mkdir()
        (renders / "hand_l_palm.png").write_bytes(b"png")
        (renders / "technical.npy").write_bytes(b"npy")
        source = self.root / "source.glb"
        source.write_bytes(b"glTF" + b"1" * 4096)
        return output, source, analysis

    def test_commit_marker_is_written_after_validated_publish(self):
        output, source, analysis = self._fixture()
        destination = app_v18._persist_run_v4(output, analysis, source)
        self.assertTrue((destination / "expires_at.json").is_file())
        self.assertEqual(json.loads((destination / "avatar_analysis.json").read_text())["runId"], analysis["runId"])
        self.assertEqual(source.read_bytes(), b"glTF" + b"1" * 4096)

    def test_public_payload_removes_duplicate_and_regenerable_debug(self):
        output, source, analysis = self._fixture(debug_size=4_000_000)
        destination = app_v18._persist_run_v4(output, analysis, source)
        payload = app_v18._public_result(destination)
        encoded = json.dumps(payload, separators=(",", ":")).encode()
        self.assertLess(len(encoded), app_v18.PUBLIC_RESULT_BUDGET_BYTES)
        self.assertNotIn("acceptedLandmarks", payload)
        self.assertNotIn("rejectedLandmarks", payload)
        self.assertNotIn("initialAttempt", payload["analysis"].get("diagnostics", {}))
        self.assertNotIn("finalAttempt", payload["analysis"].get("diagnostics", {}))
        self.assertFalse(any(path.endswith(".npy") for path in payload["assets"]["renders"]))

    def test_cleanup_keeps_writing_run_during_grace_and_removes_abandoned(self):
        run = app_v18.v32.RUN_CACHE_ROOT / ("b" * 32)
        run.mkdir()
        app_v18.v32._cleanup_expired_runs()
        self.assertTrue(run.exists())
        old = time.time() - app_v18.v32.INCOMPLETE_RUN_GRACE_SECONDS - 5
        os.utime(run, (old, old))
        app_v18.v32._cleanup_expired_runs()
        self.assertFalse(run.exists())

    def test_result_without_commit_marker_is_retryable_503(self):
        run_id = "c" * 32
        run = app_v18.v32.RUN_CACHE_ROOT / run_id
        run.mkdir()
        with self.assertRaises(app_v18.HTTPException) as captured:
            app_v18.avatar_analyze_v4_result(run_id)
        self.assertEqual(captured.exception.status_code, 503)
        self.assertEqual(captured.exception.detail["code"], "ANALYZER_RESULT_STILL_PERSISTING")
        self.assertEqual(captured.exception.headers["Retry-After"], str(app_v18.RESULT_RETRY_AFTER_SECONDS))


if __name__ == "__main__":
    unittest.main()
