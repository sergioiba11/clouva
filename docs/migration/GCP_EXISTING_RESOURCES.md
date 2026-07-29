# GCP Existing Resources (audit snapshot)

Date: 2026-07-28. Project: `gen-lang-client-0737053175`. Authenticated as `sergio.iba.11@gmail.com` (has `gcloud` access; not yet confirmed as Owner/Editor for enabling new APIs — see blockers below).

## Cloud Run services (`us-central1`)

| Service | URL | Latest revision |
|---|---|---|
| `clouva-blender-worker` | `https://clouva-blender-worker-6i67fzm65q-uc.a.run.app` | `clouva-blender-worker-00028-mmg` |
| `clouva-mediapipe-detector` | `https://clouva-mediapipe-detector-6i67fzm65q-uc.a.run.app` | `clouva-mediapipe-detector-00001-zhk` |

No `clouva-web` service exists yet. No Cloud Run Jobs exist yet (`clouva-avatar-analyzer` job is not created).

## Storage

Buckets (`us-central1`):
- `clouva-avatar-analyzer-cache` — durable run cache for the Avatar Analyzer, GCSFuse-mounted into `clouva-blender-worker` at `/data` (per prior session's memory) and target of the volume-migration endpoint.
- `run-sources-gen-lang-client-0737053175-us-central1` — Cloud Build's auto-managed source bucket, not app-relevant.

## Artifact Registry

- `cloud-run-source-deploy` (Docker, auto-created by `gcloud run deploy --source`). No dedicated `clouva` repository yet for immutable, commit-tagged multi-service images (Phase 10 work).

## Secret Manager

**Not enabled on this project.** `gcloud secrets list` returned `SERVICE_DISABLED` for `secretmanager.googleapis.com`. This blocks Phase 2 (moving runtime secrets out of plaintext env vars) until enabled.

- **Blocked action:** enable Secret Manager API.
- **Resource:** project `gen-lang-client-0737053175`.
- **Missing permission:** `serviceusage.services.enable` (or the interactive `y/N` prompt needs to be answered — non-interactive `gcloud` run refused to assume yes).
- **Exact command:** `gcloud services enable secretmanager.googleapis.com --project gen-lang-client-0737053175`
- **Expected result:** API enabled within a few minutes, unblocking `gcloud secrets create` for the secret list in Phase 2.

## IAM service accounts

| Email | Purpose |
|---|---|
| `37640598175-compute@developer.gserviceaccount.com` | Default compute SA (should not be relied on for new services per the "no default SA" rule) |
| `github-actions-deployer@gen-lang-client-0737053175.iam.gserviceaccount.com` | WIF-based deployer used by `deploy-blender-worker.yml` — reusable for the new web/mediapipe workflows |
| `ais-gemini-key-068f8e26b33c412@37640598175.iam.gserviceaccount.com` | Gemini API key SA, unrelated to this migration |
| `clouva-storage-migration@gen-lang-client-0737053175.iam.gserviceaccount.com` | Used by the existing volume-migration endpoint (`CLOUVA_GCS_MIGRATION_CREDENTIALS_JSON`) |

No `clouva-web-runtime` service account exists yet (needed for Phase 4).

## Load balancing / networking

No existing HTTPS Load Balancer, Serverless NEG, reserved global IP, or managed SSL certificate found for this project (not checked via a dedicated list command yet — to confirm in Phase 12 before creating new ones, to avoid duplicating).

## Conclusion for planning

Adopt, do not duplicate: `gen-lang-client-0737053175` project, `us-central1` region, `clouva-blender-worker`, `clouva-mediapipe-detector`, `clouva-avatar-analyzer-cache` bucket, `github-actions-deployer` service account. New resources needed: `clouva-web` Cloud Run service, `clouva-avatar-analyzer` Cloud Run Job, `clouva` Artifact Registry repo, Secret Manager secrets, `clouva-web-runtime` service account, HTTPS Load Balancer + Serverless NEG + managed cert for `clouva.com.ar`.
