# Blender Worker + MediaPipe verification (Phase 6-7)

Status 2026-07-28.

## clouva-blender-worker

- Revision serving 100%: rebuilt/redeployed multiple times this session (adopted, not duplicated -- see [GCP_EXISTING_RESOURCES.md](GCP_EXISTING_RESOURCES.md)).
- 4 vCPU / 8Gi memory, `--no-cpu-throttling` (required for its own background-thread analysis pattern to keep running after the triggering HTTP request returns -- still relevant for any caller still using `/avatar/analyze-v4-preview-async` directly, and for the still-in-use rig endpoints).
- `clouva-avatar-analyzer-cache` bucket mounted via GCSFuse at `/data` -- same bucket the new Cloud Run Job uses, confirmed via a real run (see [GCP_ANALYZER_JOB.md](GCP_ANALYZER_JOB.md)).
- `SUPABASE_SERVICE_ROLE_KEY` is still a plaintext env var on this service (not Secret Manager-backed) -- flagged in [ENVIRONMENT_VARIABLE_MAP.md](ENVIRONMENT_VARIABLE_MAP.md) Phase 2 notes, not fixed yet, low risk since it's not printed anywhere and the service isn't public-readable at the env-var level.

## Security finding: publicly invokable, not fixed yet (deliberately)

`gcloud run services get-iam-policy clouva-blender-worker` shows `roles/run.invoker` granted to `allUsers` -- the service accepts unauthenticated HTTP requests from the public internet, relying entirely on the app-level `BLENDER_WORKER_TOKEN` bearer check (when configured) rather than Cloud Run IAM.

**Not fixing this now, on purpose.** The **currently live production app on Railway** calls this worker directly over the public internet using that bearer token -- Railway has no GCP credentials to mint an IAM identity token. Switching this service to private (`roles/run.invoker` restricted to specific service accounts) would break production analysis/rig requests today, before any cutover has happened. This is exactly the kind of production-affecting change that needs to wait for Phase 15 (cutover), at which point `clouva-web` becomes the only caller and can authenticate via its own service account's IAM identity token instead of a static bearer token.

**Action for Phase 15:** once `clouva-web` is the only thing calling this worker (Railway decommissioned), switch ingress/IAM to require `roles/run.invoker` for `clouva-web-runtime@...` only, remove `allUsers`, and update `avatarAnalyzerWorkerConfig()` (`lib/avatar-analyzer-server.ts`) to attach a Google-signed identity token instead of `BLENDER_WORKER_TOKEN`. Keep `BLENDER_WORKER_TOKEN` as a defense-in-depth fallback per the migration brief's own instruction, not as the sole gate.

## clouva-mediapipe-detector

- 1 vCPU / 512Mi, concurrency 80, min 0 / max 3 instances -- matches the target config in the migration plan.
- `run.googleapis.com/ingress: all` (also public) -- same reasoning as above applies: `clouva-blender-worker` calls it directly today using `CLOUVA_MEDIAPIPE_SERVICE_TOKEN` (bearer, not IAM), and the analyzer job entrypoint reuses that exact same call path (`app.avatar_analyzer` -> MediaPipe), so it can't be locked to IAM-only before the worker itself would also need to authenticate via identity token instead of the static token. Same Phase 15 follow-up as the worker.
- Confirmed via the real analysis run in [GCP_ANALYZER_JOB.md](GCP_ANALYZER_JOB.md) that MediaPipe detection actually ran successfully as part of that pipeline (the run persisted real landmark data, not an empty/fallback result).
