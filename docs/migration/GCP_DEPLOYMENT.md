# Deployment Guide

## Normal deploys (after this migration merges)

All three application images deploy via GitHub Actions, WIF-authenticated, no stored keys:

| Workflow | Triggers on | Deploys |
|---|---|---|
| `.github/workflows/deploy-gcp-web.yml` | push to `main` touching `app/`, `components/`, `lib/`, `public/`, `Dockerfile`, etc., or manual dispatch | `clouva-web` -- builds, deploys `--no-traffic`, verifies `/api/health` reports the expected commit on the revision-tagged URL, then shifts 100% traffic |
| `.github/workflows/deploy-blender-worker.yml` | push to `main` touching `worker/garment-rig/**`, or manual dispatch | `clouva-blender-worker` (by `--source` build) + syncs `clouva-avatar-analyzer` Job to the exact same image digest |
| `.github/workflows/deploy-mediapipe.yml` | push to `main` touching `worker/mediapipe-service/**` or `worker/garment-rig/landmark_detector_2d.py`, or manual dispatch | `clouva-mediapipe-detector` (syncs the canonical detector file first) |
| `.github/workflows/verify-production.yml` | daily cron + manual dispatch | health sweep across all four resources, uploads evidence artifact |

All manual-dispatch variants take a `source_ref` input to deploy a specific branch/tag instead of `main`.

## Manual deploy (if CI is down)

```bash
# clouva-web
gcloud builds submit --project gen-lang-client-0737053175 \
  --config cloudbuild-web.yaml \
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=...,_NEXT_PUBLIC_SUPABASE_ANON_KEY=...,_DEPLOY_REF=main,COMMIT_SHA=$(git rev-parse HEAD)" \
  .
# then deploy the resulting digest with --no-traffic, verify, then update-traffic to 100 -- see deploy-gcp-web.yml for the exact steps.

# clouva-blender-worker
gcloud run deploy clouva-blender-worker --project gen-lang-client-0737053175 --region us-central1 \
  --source worker/garment-rig --command python3 \
  --args=-m,uvicorn,runtime_app:app,--host,0.0.0.0,--port,8000

# clouva-avatar-analyzer Job -- sync to whatever image the worker deploy just produced
gcloud run jobs update clouva-avatar-analyzer --project gen-lang-client-0737053175 --region us-central1 \
  --image <the image digest just deployed to clouva-blender-worker>
```

Never deploy the Job from a `gcloud builds submit --tag` run separate from the Service -- build once, deploy the same digest to both (this migration hit real drift risk here before wiring the workflow step that keeps them in sync -- see [GCP_ANALYZER_JOB.md](GCP_ANALYZER_JOB.md)).

## Environment / secrets

See [ENVIRONMENT_VARIABLE_MAP.md](ENVIRONMENT_VARIABLE_MAP.md) for the full classification. In short: `NEXT_PUBLIC_*` are build-time and public, everything else sensitive lives in Secret Manager, referenced by name (`--set-secrets KEY=secret-name:latest`), never inlined.

## A known Windows/Git-Bash gotcha (if deploying manually from a Windows dev machine)

Git Bash's MSYS layer rewrites shell arguments that look like POSIX absolute paths (e.g. `/data/...`) before they reach `gcloud.exe`, silently corrupting any other values packed into the same comma-joined flag (`https://` becomes `https;\`, etc.). Hit this for real building the Analyzer Job -- see [GCP_ANALYZER_JOB.md](GCP_ANALYZER_JOB.md) for the full story. **Fix: use a YAML spec file + `gcloud run jobs replace` / `gcloud run services replace` instead of inline flags whenever a value contains a `/`-prefixed path**, or run from WSL/Linux/CI instead. This only affects local Windows shells -- GitHub Actions runners are Linux and unaffected.
