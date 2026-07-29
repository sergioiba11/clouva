# CLOUVA — Google Cloud Architecture

```
USUARIO
  |
clouva.com.ar
  |
Google Cloud HTTPS Load Balancer (clouva-web-lb)
  IP: 136.69.74.221 | managed cert: clouva-web-cert
  |
Cloud Run Service: clouva-web (Next.js 15 / React 19)
  service account: clouva-web-runtime
  |
  +-- Supabase (dpawotcignpexkirhfsk, us-east-2) -- unchanged by this migration
  |     Auth, PostgreSQL, RLS, Storage
  |     new table: avatar_analyzer_jobs
  |
  +-- Cloud Run Service: clouva-blender-worker
  |     4 vCPU / 8Gi, GCSFuse mount -> clouva-avatar-analyzer-cache at /data
  |     still serves: rigging endpoints, legacy V3.2/V4 sync endpoints
  |
  +-- Cloud Run Job: clouva-avatar-analyzer
  |     same image as clouva-blender-worker, different entrypoint
  |     (analyzer_job_entrypoint.py) -- one task per execution
  |     service account: clouva-avatar-analyzer-job
  |     reads/writes avatar_analyzer_jobs, mints its own signed source URLs
  |
  +-- Cloud Run Service: clouva-mediapipe-detector
  |     1 vCPU / 512Mi, called by clouva-blender-worker and the Analyzer Job
  |
  +-- Google Cloud Storage: clouva-avatar-analyzer-cache
        avatar-analyzer-runs/<runId>/          -- live run cache (GCSFuse-served)
        railway-volume-migration/<runId>/      -- migrated historical Railway data
        avatar-analyzer-jobs/                  -- legacy worker job-status files (HTTP-thread path)
```

## Service accounts (no default compute SA used for anything new)

| Service account | Used by | Access |
|---|---|---|
| `clouva-web-runtime` | `clouva-web` | Secret Manager (7 secrets), `run.developer` on `clouva-avatar-analyzer` (to trigger/cancel executions) |
| `clouva-avatar-analyzer-job` | `clouva-avatar-analyzer` Job | Secret Manager (`clouva-supabase-service-role-key`), `storage.objectAdmin` on `clouva-avatar-analyzer-cache` |
| `github-actions-deployer` | CI/CD (WIF, no stored keys) | `run.admin`, `artifactregistry.writer`, `cloudbuild.builds.editor`, `storage.admin`, `iam.serviceAccountUser` |
| `clouva-storage-migration` | pre-existing, used by the Railway->GCS migration endpoint | GCS access for the migration bucket |
| `37640598175-compute@...` (default) | `clouva-blender-worker`, `clouva-mediapipe-detector` (pre-existing, adopted as-is) | broad -- not changed by this migration; a dedicated SA for these is a good follow-up, not done here to avoid re-plumbing already-working IAM bindings mid-migration |

## Data flow: an Avatar Analyzer run

1. Browser -> `clouva-web` `POST /api/avatar/analyze` (Supabase session Bearer token).
2. `clouva-web` resolves the user's active avatar's source (Supabase Storage path or external URL fallback), inserts a `queued` row into `avatar_analyzer_jobs`, calls the Cloud Run Admin API (`jobs.run`) using its own IAM identity -- no shared secret between `clouva-web` and the Job.
3. `clouva-avatar-analyzer` Job execution starts, reads the job row, mints a short-lived signed URL for the source GLB (never stores one), runs the same Blender/MediaPipe pipeline the HTTP worker always ran (`app._run_analysis_v4`, unmodified), writes progress to the row as it goes, persists results to GCS.
4. `clouva-web` polls `GET /api/avatar/analyze/job/{id}` (reads the row), and on completion writes the summary into `user_avatars.metadata` exactly like the old flow did.
5. Cancellation: `POST .../cancel` calls the Cloud Run Admin API to cancel the execution, then unconditionally finalizes the row to `cancelled` (handles both "the entrypoint caught SIGTERM and settled it itself" and "it was still cold-starting and nothing was running to catch the signal").

## What is explicitly unchanged

Avatar Analyzer/AutoRig/rig anatomical logic (`avatar_analyzer_v4.py`, `autorig_avatar_v19.py`, `complete_avatar_rig_v10.py`, `analyzer_v4_contract.py`, etc.) -- zero diff against `main` for any of it. Supabase schema, Auth, and RLS for everything except the one new table. Public API contracts for every existing `/api/avatar/analyze/*` route.
