# Railway Inventory (audit snapshot)

Date: 2026-07-28. Branch: `claude/migrate-railway-google-cloud-71f115` (base SHA `3f1fc7b`).

## Railway account / project

- Account: `sergioiba11` (sergio.iba.11@gmail.com), Railway CLI authenticated.
- Workspace: `sergioiba11's Projects`.
- Projects visible:
  - `Clouva` (`738f9622-30b0-4aea-8c5d-0d8db474a47a`) — **production, in scope for this migration.**
  - `unique-trust` (`439c3eec-8467-48ac-ac59-081fd53aeaab`) — legacy Blender worker host (`rig.clouva.com.ar`), already superseded by `clouva-blender-worker` on Cloud Run per prior migration work. Not touched by app config anymore (`BLENDER_WORKER_URL` no longer points here) but not yet decommissioned.

## Railway project `Clouva` — service inventory

- Environment: `production` (`b34dc32a-906e-40dd-9082-f028e695bb98`), single environment.
- Service: `clouva` (`b94a493d-3150-423a-b84f-ddf6c6362cb3`) — the Next.js app. **This is the only thing left running in Railway production.**
- Custom domain: `clouva.com.ar` → service `clouva`, target port 8080. No `*.railway.app` service domain currently attached.
- Build config (`railway-web.json`): Nixpacks builder, `npm run build`, start command `npm run start -- -p $PORT`, healthcheck `/` (300s timeout), restart on failure (10 retries).

### Environment variables on `clouva` (names only — values not read)

Application variables:
`BLENDER_WORKER_URL`, `CLOUVA_ADMIN_EMAILS`, `CLOUVA_ADMIN_UPLOAD_SECRET`, `CLOUVA_AVATAR_URL`, `CLOUVA_BRIDGE_TOKEN`, `GARMENT_RIG_WORKER_URL`, `GEMINI_API_KEY`, `GITHUB_BRANCH`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `MESHY_API_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Railway-injected (auto, disappear once off Railway — no action needed, just don't hardcode a dependency on them):
`RAILWAY_ENVIRONMENT`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_PRIVATE_DOMAIN`, `RAILWAY_PROJECT_ID`, `RAILWAY_PROJECT_NAME`, `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_SERVICE_CLOUVA_URL`, `RAILWAY_SERVICE_ID`, `RAILWAY_SERVICE_NAME`, `RAILWAY_STATIC_URL`.

See [ENVIRONMENT_VARIABLE_MAP.md](ENVIRONMENT_VARIABLE_MAP.md) for the classification and Cloud Run destination of each.

## Repo references to Railway (grep, 2026-07-28)

| File | Nature |
|---|---|
| `worker/garment-rig/app_v18.py`, `rig_garment_v32.py` | Comment/string references only (worker already Cloud Run-native) |
| `railway-web.json` | Railway build/deploy config for the Next.js app — **to remove after cutover** |
| `next.config.ts` | Comment noting Railway does typecheck/build in Nixpacks — needs updating once Cloud Build takes over |
| `lib/clouva-ai/vision.ts`, `lib/clouva-ai/github.ts` | Reference `RAILWAY_*` or similar env plumbing for the internal Clouva-AI tooling — needs review during Phase 2 |
| `docs/unreal-bridge-deploy-2026-07-21.md`, `docs/CLOUVA_VISION.md`, `docs/CLOUVA_PROJECT_AUDIT.md`, `docs/CLOUVA_AI_PLAYBOOK.md` | Docs mentioning Railway as current infra — update in Phase 18 |
| `deploy-vercel-parallel-2026-07-14.txt` | Historical note, Vercel not Railway — informational only, harmless |
| `app/railway-deploy-trigger.txt`, `.railway-deploy-trigger`, `.railway/redeploy-2026-07-22.txt` | Empty trigger files used only to force Railway redeploys via the workflow below — **delete in Phase 16** |
| `.github/workflows/railway-direct-deploy.yml` | GitHub Actions workflow that runs `railway up` on push using `RAILWAY_TOKEN`/`RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_TOKEN`/`RAILWAY_DEPLOY_TOKEN` secrets — **the actual production deploy path today; replace in Phase 11, delete in Phase 16** |
| `app/api/gemini/route.ts`, `app/api/clouva-ai/{read,models,chat,agent}/route.ts`, `app/api/avatar/rig/route.ts` | Match on generic tokens (`PORT`, url building) — need per-file review, not necessarily Railway-specific |

No `railway.app` or `railway.internal` literal hostnames found baked into app code — the app talks to Railway only via the injected `RAILWAY_*` vars and the deploy workflow, not via hardcoded URLs to itself.

## Already-existing groundwork (from prior sessions, per repo history)

- `.github/workflows/deploy-blender-worker.yml` — WIF-based Cloud Run deploy pipeline for `clouva-blender-worker`, already working.
- `worker/garment-rig/app_v18.py` — background-job pattern (`analyze-v4-preview-async` / job polling), GCS-backed run cache, storage inventory diagnostics endpoint, `/diagnostics/avatar-analyzer-v4-migrate-to-gcs` migration endpoint with `CLOUVA_MIGRATION_TOKEN` auth, CRC32C + SHA-256 verification, idempotent re-run support.
- Cloud Run services `clouva-blender-worker` and `clouva-mediapipe-detector` already deployed and serving (see [GCP_EXISTING_RESOURCES.md](GCP_EXISTING_RESOURCES.md)).

This means Phases 6/7/9 of the migration (Blender worker, MediaPipe, volume migration machinery) are largely **adopt-and-verify**, not build-from-scratch. The genuinely new work is: containerizing and deploying the Next.js app itself (`clouva-web`), the Avatar Analyzer as a Cloud Run Job (currently still a background thread inside the Blender worker HTTP process), the load balancer + DNS cutover, and retiring the Railway service.
