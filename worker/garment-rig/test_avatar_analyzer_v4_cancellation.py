
from __future__ import annotations

import subprocess
import sys
import time
import unittest

try:
    import app_v18
except ModuleNotFoundError:  # Docker promotes app_v18.py to app.py.
    import app as app_v18


class AvatarAnalyzerV4CancellationTests(unittest.TestCase):
    def setUp(self):
        app_v18._RUNNING_JOBS.clear()

    def tearDown(self):
        app_v18._RUNNING_JOBS.clear()

    def test_cancel_requested_is_false_for_unknown_job(self):
        self.assertFalse(app_v18._job_cancel_requested("unknown"))
        self.assertFalse(app_v18._job_cancel_requested(None))

    def test_register_process_refuses_once_cancel_is_requested(self):
        job_id = "a" * 32
        app_v18._RUNNING_JOBS[job_id] = {"cancelRequested": True}
        accepted = app_v18._register_job_process(job_id, object())
        self.assertFalse(accepted)

    def test_kill_process_group_terminates_a_real_subprocess(self):
        proc = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            start_new_session=True,
        )
        try:
            self.assertIsNone(proc.poll())
            app_v18._kill_process_group(proc)
            proc.wait(timeout=5)
            self.assertIsNotNone(proc.poll())
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)

    def test_blender_phases_raise_cancelled_before_spawning_when_already_requested(self):
        job_id = "b" * 32
        app_v18._RUNNING_JOBS[job_id] = {"cancelRequested": True}
        with self.assertRaises(app_v18.AnalysisCancelled):
            app_v18._run_v4_blender_phases(
                input_path=None,
                output_dir=None,
                environment={},
                job_dir=None,
                job_id=job_id,
            )

    def test_job_cancel_endpoint_is_idempotent_on_terminal_jobs(self):
        job_id = "c" * 32
        app_v18._write_job_status(job_id, {"status": "done", "runId": "d" * 32})
        response = app_v18.avatar_analyze_v4_job_cancel(job_id)
        payload = app_v18.json.loads(response.body)
        self.assertEqual(payload["status"], "done")

    def test_job_cancel_endpoint_marks_pending_job_cancelled_and_frees_registry(self):
        job_id = "e" * 32
        app_v18._write_job_status(job_id, {"status": "pending"})
        response = app_v18.avatar_analyze_v4_job_cancel(job_id)
        payload = app_v18.json.loads(response.body)
        self.assertEqual(payload["status"], "cancelled")
        status_after = app_v18.json.loads(app_v18._job_status_path(job_id).read_text())
        self.assertEqual(status_after["status"], "cancelled")

    def test_job_cancel_endpoint_kills_the_registered_process(self):
        job_id = "f" * 32
        app_v18._write_job_status(job_id, {"status": "pending"})
        proc = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            start_new_session=True,
        )
        try:
            app_v18._RUNNING_JOBS[job_id] = {"proc": proc}
            app_v18.avatar_analyze_v4_job_cancel(job_id)
            time.sleep(0.2)
            proc.wait(timeout=5)
            self.assertIsNotNone(proc.poll())
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)

    def test_background_runner_writes_cancelled_status_and_clears_registry(self):
        job_id = "1" * 32
        app_v18._RUNNING_JOBS[job_id] = {"cancelRequested": True}
        app_v18._run_analysis_v4_background(job_id, "https://example.com/avatar.glb", "BODY_BASIC")
        status = app_v18.json.loads(app_v18._job_status_path(job_id).read_text())
        self.assertEqual(status["status"], "cancelled")
        self.assertNotIn(job_id, app_v18._RUNNING_JOBS)


if __name__ == "__main__":
    unittest.main()
