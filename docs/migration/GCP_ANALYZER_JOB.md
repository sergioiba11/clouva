# Avatar Analyzer Cloud Run Job (Phase 5)

Status 2026-07-28: **infrastructure built and smoke-tested for real; Next.js API routes not yet wired to it.** The live Analyzer flow (`/api/avatar/analyze/*` -> worker's `/avatar/analyze-v4-preview-async` background thread) is **unchanged and still what production uses** -- nothing here is live yet.

## What exists

- Supabase table `avatar_analyzer_jobs` (migration `20260728050000_avatar_analyzer_jobs.sql`) -- durable job state, RLS read-only for the owning user, all writes via service role.
- `worker/garment-rig/analyzer_job_entrypoint.py` -- Cloud Run Job entrypoint. Imports the same `app_v18` module the HTTP service runs and calls `_run_analysis_v4(...)` unchanged; only adds job I/O against Supabase (fetch job row, mint a short-lived signed URL for the source GLB right before downloading instead of storing one, write status/progress/result, SIGTERM-based cancellation reusing the existing `_RUNNING_JOBS`/`_kill_process_group` machinery).
- `worker/garment-rig/test_analyzer_job_entrypoint.py` -- 4 tests (missing job id, cancel-before-start, missing source, full success path with mocked Supabase calls and a mocked `_run_analysis_v4`). Added to the Dockerfile's unittest step so they run for real on every image build.
- Image `us-central1-docker.pkg.dev/gen-lang-client-0737053175/clouva/clouva-avatar-analyzer@sha256:e7e172d4b66b3f1b5aa3febdf1e8948b2119d01365840ca0f4726d4ca55e9bc8` (commit `c32a105`), built via `gcloud builds submit --tag ... worker/garment-rig` -- the full Docker build (including all 29 unittest cases and every Blender-headless self-test) passed.
- Cloud Run Job `clouva-avatar-analyzer`, `us-central1`, 4 vCPU / 8Gi, `clouva-avatar-analyzer-cache` bucket mounted via GCSFuse at `/data` (same bucket the HTTP worker already uses), dedicated SA `clouva-avatar-analyzer-job@...` (secretAccessor on `clouva-supabase-service-role-key`, `storage.objectAdmin` on the run-cache bucket only), `maxRetries: 0`, `parallelism: 1`, `taskCount: 1`, `timeoutSeconds: 3600`.

## Bug found and fixed while building this

The first two `gcloud run jobs create`/`update` attempts silently corrupted every URL-like value in the same `--set-env-vars` string (`https://...` became `https;\...`, `/data/...` became a Windows path) -- **Git Bash's MSYS path-conversion layer rewrites shell arguments that look like POSIX paths before they reach `gcloud.exe`**, and once one value in the comma-joined string triggers it (`/data/avatar-analyzer-runs`), the mangling spread to the neighboring values in the same argument. Confirmed via `gcloud run jobs describe` that the resulting env vars were garbage before anything was ever executed. `clouva-web`'s deploy (Phase 4) was unaffected because none of its env values started with a bare `/`. Fixed by defining the job through a YAML spec file and `gcloud run jobs replace` instead of inline `--set-env-vars`/`--add-volume-mount` flags, which never passes the values through shell argument parsing. Re-verified with `describe` that every value is correct before running anything.

## Smoke test (real, run 2026-07-28)

`gcloud run jobs execute clouva-avatar-analyzer --update-env-vars CLOUVA_ANALYZER_JOB_ID=00000000-0000-0000-0000-000000000000`

Execution `clouva-avatar-analyzer-n7kfv`: container started, GCSFuse mount succeeded, entrypoint queried Supabase, correctly found no such job, logged `[analyzer-job] job 00000000-0000-0000-0000-000000000000 not found in avatar_analyzer_jobs`, exited 1. `executions describe` confirms `failedCount: 1` (expected -- this was intentionally an unknown job id). This proves the image, entrypoint, Secret Manager wiring, GCSFuse volume, and Supabase connectivity all work together end to end. It does **not** prove a real Blender analysis run works yet -- that needs a real job row with a real `source_storage_path`, which only happens once the Next.js side creates one.

## Not done yet

1. Rewire `app/api/avatar/analyze/*` (and `_shared.ts`) to create a row in `avatar_analyzer_jobs` and trigger a Cloud Run Job execution (via the Cloud Run Admin API, using `clouva-web-runtime`'s own credentials -- no service-account key file) instead of calling the worker's `/avatar/analyze-v4-preview-async`. Public contract (request/response shapes of the existing routes) must not change.
2. Poll job status from `avatar_analyzer_jobs` instead of the worker's `/avatar/analyze-v4/job/{id}`.
3. Cancellation: call the Cloud Run Jobs execution-cancel API instead of the worker's `/cancel` endpoint.
4. A real end-to-end run with an actual avatar GLB (Phase 14), through `clouva-web` (not production) before any of this touches Railway/production.
