# Environment Variable Map

Classification of every variable currently set on Railway's `clouva` service, and its Google Cloud destination. Values were never read by this audit — only variable names (via Railway's redacted `list-variables`) and their usage sites in code.

| Variable | Class | Cloud Run destination | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | A. Public build-time | Build arg + runtime env on `clouva-web` | Safe to expose, needed client-side |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | A. Public build-time | Build arg + runtime env on `clouva-web` | Safe to expose (RLS-protected) |
| `NEXT_PUBLIC_SUPABASE_KEY` | D. Obsolete (Railway leftover) | None | Confirmed unused — no reference anywhere in the codebase. Only `NEXT_PUBLIC_SUPABASE_ANON_KEY` is read (`lib/supabase.ts`). Do not carry into Cloud Run. |
| `SUPABASE_SERVICE_ROLE_KEY` | B. Secret runtime | Secret Manager: `clouva-supabase-service-role-key` | **Never** expose as `NEXT_PUBLIC_*`; server-only. Confirmed the actively-used var (30 references) |
| `SUPABASE_SERVICE_KEY` | D. Obsolete (Railway leftover) | None | Confirmed unused — no reference anywhere in the codebase. Do not carry into Cloud Run. |
| `GEMINI_API_KEY` | B. Secret runtime | Secret Manager: `clouva-gemini-api-key` | Used by `app/api/gemini/route.ts`, Clouva-AI tooling |
| `OPENAI_API_KEY` | B. Secret runtime | Secret Manager: `clouva-openai-api-key` | |
| `MESHY_API_KEY` | B. Secret runtime | Secret Manager: `clouva-meshy-api-key` | |
| `GITHUB_TOKEN` | B. Secret runtime | Secret Manager: `clouva-github-token` | Used by Clouva-AI's GitHub integration (`lib/clouva-ai/github.ts`) — scope/rotate if it's a personal token |
| `CLOUVA_ADMIN_UPLOAD_SECRET` | B. Secret runtime | Secret Manager: `clouva-admin-upload-secret` | |
| `CLOUVA_BRIDGE_TOKEN` | B. Secret runtime | Secret Manager: `clouva-bridge-token` | Used by the Unreal bridge integration |
| `BLENDER_WORKER_URL` | C. Non-secret config | Runtime env on `clouva-web` | Update value to the Cloud Run `clouva-blender-worker` URL (already Cloud Run today per prior migration — confirm current value points at `https://clouva-blender-worker-*.run.app`, not Railway) |
| `GARMENT_RIG_WORKER_URL` | C. Non-secret config | Runtime env on `clouva-web` | Likely alias/legacy name for `BLENDER_WORKER_URL` — confirm usage before setting both |
| `CLOUVA_AVATAR_URL` | C. Non-secret config | Runtime env on `clouva-web` | |
| `CLOUVA_ADMIN_EMAILS` | C. Non-secret config | Runtime env on `clouva-web` | Not secret (just an allowlist), but not `NEXT_PUBLIC_*` either — stays server-only |
| `GITHUB_OWNER` | C. Non-secret config | Runtime env on `clouva-web` | |
| `GITHUB_REPO` | C. Non-secret config | Runtime env on `clouva-web` | |
| `GITHUB_BRANCH` | C. Non-secret config | Runtime env on `clouva-web` | |
| `RAILWAY_ENVIRONMENT`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_PRIVATE_DOMAIN`, `RAILWAY_PROJECT_ID`, `RAILWAY_PROJECT_NAME`, `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_SERVICE_CLOUVA_URL`, `RAILWAY_SERVICE_ID`, `RAILWAY_SERVICE_NAME`, `RAILWAY_STATIC_URL` | D. Obsolete (Railway-injected) | None | Auto-injected by Railway, not set by us; simply won't exist on Cloud Run. Grep confirmed the app doesn't read most of these directly — `lib/clouva-ai/vision.ts` / `github.ts` need a line-level check in Phase 2 to confirm nothing depends on `RAILWAY_PUBLIC_DOMAIN` etc. for building canonical URLs (should use `NEXT_PUBLIC_SITE_URL` / the site's own domain instead) |

## Resolved (2026-07-28)

1. **Duplicate vars resolved by grep**: `NEXT_PUBLIC_SUPABASE_KEY` and `SUPABASE_SERVICE_KEY` are unreferenced anywhere in the codebase — dead Railway-era leftovers, reclassified to D (obsolete) above, not carried into Secret Manager/Cloud Run.
2. **`lib/clouva-ai/vision.ts` and `lib/clouva-ai/github.ts`**: no `RAILWAY_*` references found — clean, no code change needed for the Cloud Run move.
3. `PORT` handling is a non-issue: Cloud Run injects `$PORT` the same way Railway does, and `next start -p $PORT` (or the standalone server's own `PORT` read) works unchanged.

## Secret Manager status — DONE (2026-07-28)

Secret Manager API enabled on `gen-lang-client-0737053175`. All 8 secrets created and populated with a version:

| Secret | Source | Status |
|---|---|---|
| `clouva-supabase-service-role-key` | Railway `SUPABASE_SERVICE_ROLE_KEY` | populated |
| `clouva-gemini-api-key` | Railway `GEMINI_API_KEY` | populated |
| `clouva-openai-api-key` | Railway `OPENAI_API_KEY` | populated |
| `clouva-meshy-api-key` | Railway `MESHY_API_KEY` | populated |
| `clouva-github-token` | Railway `GITHUB_TOKEN` | populated |
| `clouva-admin-upload-secret` | Railway `CLOUVA_ADMIN_UPLOAD_SECRET` | populated |
| `clouva-bridge-token` | Railway `CLOUVA_BRIDGE_TOKEN` | populated |
| `clouva-migration-token` | newly generated (32-byte urlsafe) | populated, **new value — the worker had no `CLOUVA_MIGRATION_TOKEN` set at all before this**, so the volume-migration endpoint was previously unreachable (always 403) |

Values were moved via a one-shot local pipe (`railway variables --json` → a Python script → `gcloud secrets versions add --data-file=-`) that never echoed a value to any tool output; the script and the temp file holding the raw Railway JSON were deleted immediately after.

`clouva-blender-worker` was updated (revision `clouva-blender-worker-00029-qfx`) to source `CLOUVA_MIGRATION_TOKEN` from `clouva-migration-token:latest` via `--update-secrets`, with `secretAccessor` granted to its runtime SA (`37640598175-compute@developer.gserviceaccount.com` — the default compute SA; a dedicated `clouva-blender-worker` SA is a nice-to-have not done here since it'd mean re-granting existing bucket IAM). Verified healthy post-deploy (`/diagnostics/avatar-analyzer-v4` → 200). `SUPABASE_SERVICE_ROLE_KEY` on this service is still a plaintext env var, not yet Secret-Manager-backed — left as-is for this pass since it's already deployed and working; worth migrating in the same follow-up as the SA hardening.

`clouva-web`'s own copies of these secrets (as `--update-secrets` bindings on the new Cloud Run service) happen in Phase 4 once the service exists.
