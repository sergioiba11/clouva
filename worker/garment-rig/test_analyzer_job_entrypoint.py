from __future__ import annotations

import os
import unittest
from unittest.mock import patch

import analyzer_job_entrypoint as entry

try:
    import app_v18
except ModuleNotFoundError:  # Docker promotes app_v18.py to app.py.
    import app as app_v18


class AnalyzerJobEntrypointTests(unittest.TestCase):
    def setUp(self):
        app_v18._RUNNING_JOBS.clear()
        self._env_patch = patch.dict(
            os.environ,
            {
                "CLOUVA_ANALYZER_JOB_ID": "job-1",
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role-test-key",
            },
        )
        self._env_patch.start()
        entry.SUPABASE_URL = "https://example.supabase.co"
        entry.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key"

    def tearDown(self):
        self._env_patch.stop()
        app_v18._RUNNING_JOBS.clear()

    def test_missing_job_id_env_exits_2(self):
        with patch.dict(os.environ, {"CLOUVA_ANALYZER_JOB_ID": ""}):
            self.assertEqual(entry.main(), 2)

    def test_cancel_requested_before_start_marks_cancelled_without_running_blender(self):
        calls: list[tuple[str, str, dict | None]] = []

        def fake_supabase_call(method, url, body=None):
            calls.append((method, url, body))
            if method == "GET":
                return [{"id": "job-1", "status": "cancel_requested"}]
            return {}

        with patch.object(entry, "_supabase_call", side_effect=fake_supabase_call), \
             patch.object(app_v18, "_run_analysis_v4") as run_mock:
            self.assertEqual(entry.main(), 0)
            run_mock.assert_not_called()

        patch_calls = [call for call in calls if call[0] == "PATCH"]
        self.assertEqual(len(patch_calls), 1)
        self.assertEqual(patch_calls[0][2]["status"], "cancelled")

    def test_missing_source_storage_path_fails_the_job(self):
        def fake_supabase_call(method, url, body=None):
            if method == "GET":
                return [{"id": "job-1", "status": "queued", "source_storage_path": None}]
            return {}

        with patch.object(entry, "_supabase_call", side_effect=fake_supabase_call):
            self.assertEqual(entry.main(), 1)

    def test_external_url_source_is_used_directly_without_signing(self):
        job_row = {
            "id": "job-1",
            "status": "queued",
            "source_storage_path": "https://meshy.example/avatar-original.glb",
            "requested_rig_profile": "BODY_BASIC",
            "operation": "full_analysis",
        }
        seen_source_urls: list[str] = []

        def fake_supabase_call(method, url, body=None):
            if method == "GET":
                return [job_row]
            if method == "POST":
                raise AssertionError("should not mint a signed URL for an external source")
            if method == "PATCH":
                return {}
            raise AssertionError(f"unexpected method {method}")

        def fake_run_analysis(source_url, *_args, **_kwargs):
            seen_source_urls.append(source_url)
            return ("job_dir", "output_dir", False, {"runId": "r" * 32, "overall_status": "approved", "landmarks": {}, "warnings": []})

        with patch.object(entry, "_supabase_call", side_effect=fake_supabase_call), \
             patch.object(app_v18, "_run_analysis_v4", side_effect=fake_run_analysis), \
             patch("shutil.rmtree"):
            self.assertEqual(entry.main(), 0)

        self.assertEqual(seen_source_urls, ["https://meshy.example/avatar-original.glb"])

    def test_successful_run_persists_completion_and_clears_running_registry(self):
        job_row = {
            "id": "job-1",
            "status": "queued",
            "source_storage_path": "user-1/avatar-original.glb",
            "requested_rig_profile": "BODY_BASIC",
            "operation": "full_analysis",
        }
        patched_fields: list[dict] = []

        def fake_supabase_call(method, url, body=None):
            if method == "GET":
                return [job_row]
            if method == "POST":  # signed URL mint
                return {"signedURL": "/object/sign/avatars/user-1/avatar-original.glb?token=abc"}
            if method == "PATCH":
                patched_fields.append(body)
                return {}
            raise AssertionError(f"unexpected method {method}")

        fake_analysis = {"runId": "r" * 32, "overall_status": "approved", "landmarks": {}, "warnings": []}

        with patch.object(entry, "_supabase_call", side_effect=fake_supabase_call), \
             patch.object(app_v18, "_run_analysis_v4", return_value=("job_dir", "output_dir", False, fake_analysis)), \
             patch("shutil.rmtree") as rmtree_mock:
            self.assertEqual(entry.main(), 0)

        statuses = [fields["status"] for fields in patched_fields]
        self.assertEqual(statuses, ["starting", "running", "persisting", "completed"])
        self.assertEqual(patched_fields[-1]["run_id"], "r" * 32)
        self.assertEqual(patched_fields[-1]["summary"]["status"], "approved")
        self.assertNotIn("job-1", app_v18._RUNNING_JOBS)
        rmtree_mock.assert_called_once_with("job_dir", ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
