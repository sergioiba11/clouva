# GCP Deployment — clouva-web

Status as of 2026-07-28: deployed and healthy, **not yet receiving production traffic** (`clouva.com.ar` still points at Railway; that cutover is a separate, explicitly-confirmed step — see [GCP_ROLLBACK.md](GCP_ROLLBACK.md) once written and Phase 12/15 in the migration plan).

## Current deployment

- Service: `clouva-web`, project `gen-lang-client-0737053175`, region `us-central1`.
- URL: `https://clouva-web-37640598175.us-central1.run.app`
- Image: `us-central1-docker.pkg.dev/gen-lang-client-0737053175/clouva/clouva-web@sha256:031e108b2bfcdfc2ce5456e213ddce4ccd622612e8370e13afdd722ff492b66b` (tag `f11eda8bfb864f5988b717886526755e7b522507`, i.e. that commit SHA)
- Revision: `clouva-web-00001-xbx`, serving 100% of traffic **on this service** (irrelevant to production since nothing points at this URL yet)
- Runtime SA: `clouva-web-runtime@gen-lang-client-0737053175.iam.gserviceaccount.com` (dedicated, not the default compute SA), granted `secretAccessor` on the 7 secrets it needs.
- Config: 1 vCPU, 1 GiB, min 0 / max 10 instances, concurrency 40, timeout 60s, startup CPU boost on, public (`--allow-unauthenticated`, same as the current Railway-hosted app).

## How it was built

`cloudbuild-web.yaml` at repo root — `docker build` with `--build-arg` for the two public `NEXT_PUBLIC_*` values (baked into the client bundle at build time, as Next.js requires) plus commit/ref/build-date metadata, tagged by commit SHA, pushed to the `clouva` Artifact Registry repo. Run via:

```
gcloud builds submit --project gen-lang-client-0737053175 \
  --config cloudbuild-web.yaml \
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=...,_NEXT_PUBLIC_SUPABASE_ANON_KEY=...,_DEPLOY_REF=<branch>,COMMIT_SHA=<sha>" \
  .
```

Deployed by immutable digest (not `:latest`) via `gcloud run deploy clouva-web --image <repo>@sha256:...`.

## Verified so far (2026-07-28)

- `npm ci`, `npm run typecheck`, `npm run build` (standalone output), `npm test` (90 + 29 tests) all green locally before the container build.
- Cloud Build succeeded (real `docker build` inside Cloud Build, since no local Docker is available in the dev environment used for this migration).
- Deployed service: `/` → 200, `/api/health` → `{"ok":true,"commit":"f11eda8...","ref":"claude/migrate-railway-google-cloud-71f115","revision":"clouva-web-00001-xbx",...}`, `/catalogo` → 200, `/login` → 200, `/biblioteca` → 200.

## Not yet verified (tracked separately — Phase 14)

Full authenticated flows (Supabase login, avatar library, checkout), the Avatar Analyzer end-to-end through this new service, and mobile rendering. These need either a logged-in test session or a real avatar run, which is Phase 14 work, done right before cutover — not claimed as done here.

## Known gap carried over from the audit

`CLOUVA_AVATAR_URL` (Railway var) was **not** carried into `clouva-web`'s env: grep confirmed no TypeScript/Next.js code reads it (only `worker/garment-rig/app.py` does, and the deployed worker doesn't have it set either — it resolves the active avatar dynamically via Supabase instead). Its Railway value pointed at `https://rig.clouva.com.ar/health`, the **legacy** Railway-hosted worker — stale and already dead weight before this migration.
