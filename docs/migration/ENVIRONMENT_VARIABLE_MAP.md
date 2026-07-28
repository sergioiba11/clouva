# Environment Variable Map

Classification of every variable currently set on Railway's `clouva` service, and its Google Cloud destination. Values were never read by this audit — only variable names (via Railway's redacted `list-variables`) and their usage sites in code.

| Variable | Class | Cloud Run destination | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | A. Public build-time | Build arg + runtime env on `clouva-web` | Safe to expose, needed client-side |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | A. Public build-time | Build arg + runtime env on `clouva-web` | Safe to expose (RLS-protected) |
| `NEXT_PUBLIC_SUPABASE_KEY` | A. Public build-time | Build arg + runtime env on `clouva-web` | Appears to duplicate `NEXT_PUBLIC_SUPABASE_ANON_KEY` — confirm in code before dropping either |
| `SUPABASE_SERVICE_ROLE_KEY` | B. Secret runtime | Secret Manager: `clouva-supabase-service-role-key` | **Never** expose as `NEXT_PUBLIC_*`; server-only |
| `SUPABASE_SERVICE_KEY` | B. Secret runtime | Secret Manager: `clouva-supabase-service-key` (or confirm it's an alias of the above and drop) | Verify against `SUPABASE_SERVICE_ROLE_KEY` for duplication before creating two secrets |
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

## Open items before Phase 2 can close

1. Confirm whether `NEXT_PUBLIC_SUPABASE_KEY` and `SUPABASE_SERVICE_KEY` are live duplicates of `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (grep usage sites) before deciding to carry both into Secret Manager/Cloud Run.
2. Read `lib/clouva-ai/vision.ts` and `lib/clouva-ai/github.ts` for any `RAILWAY_*` reads that need a Cloud-Run-native replacement (e.g. building a canonical site URL).
3. Confirm no code reads `PORT` with a Railway-specific default that would conflict with Cloud Run's own `PORT` injection (Cloud Run also injects `PORT`, so this should be a non-issue, but the `railway-web.json` start command explicitly passes `-p $PORT` — Cloud Run's Next.js `next start` also honors `$PORT` natively, so this carries over cleanly).
