# Phase 14 — End-to-end verification report

Date: 2026-07-29. Target: `clouva-web` on Cloud Run (`https://clouva-web-37640598175.us-central1.run.app`, revision `clouva-web-00002-smp`, commit `537ff6f`). **Not production** -- `clouva.com.ar` still serves from Railway; this is the isolated pre-cutover verification the plan requires before touching DNS.

## Method

Redeployed `clouva-web` with the current branch HEAD first (the live revision predated the Cloud Run Job wiring). Then, rather than a browser click-through, authenticated as the real official test account (`CLOUVA_OFFICIAL_AVATAR_USER_ID` / `sergio.iba.11@gmail.com`, the account the worker itself already uses for "official avatar" resolution) via Supabase's admin `generate_link` + direct `/auth/v1/verify` exchange -- this returns a real access token without needing a browser redirect flow, and was then used as a normal `Authorization: Bearer` header against `clouva-web`'s actual API routes with `curl`. This exercises the exact same code path a real browser session would (`requireUser` reads the same header), just without driving a UI. All tokens were generated fresh for this test and the scratch files holding them were deleted immediately after.

## Verified (real, through the actual deployed API)

1. **POST `/api/avatar/analyze`** → real `jobId`, triggers a real Cloud Run Job execution via the Cloud Run Admin API using `clouva-web-runtime`'s own IAM identity (no service-account key file) -- confirmed the metadata-server token approach in `lib/cloud-run-jobs.ts` works for real from inside Cloud Run, not just in theory.
2. **Full real analysis run end to end**: `queued → starting → running → persisting → completed`, `job.summary` populated correctly (this specifically re-verifies the summary-column fix from earlier in Phase 5, now through the real HTTP path).
3. **GET `/api/avatar/analyze/job/{jobId}`** correctly maps DB status to the legacy `{status, runId, summary, detail}` shape at every stage.
4. **GET `/api/avatar/analyze/result/{runId}`** returns the full analysis + summary for a completed run.
5. **GET `/api/avatar/analyze/latest`** picks up the newly completed run and clears the pending marker (`avatar_analyzer_v4_pending` -> null, `avatar_analyzer_v4.runId` updated) -- confirms `persistCompletedAnalyzerJob` fires correctly from the real polling route.
6. **Concurrency guard, tested properly this time**: fired two `POST /api/avatar/analyze` calls back-to-back while a job was still in flight -- the second call returned the *same* `jobId` with `reused: true`, no duplicate execution started. (First attempt at this test was mistimed -- the prior job had already finished in the ~74s it takes, so it legitimately started a new one; re-ran the test correctly on the next job and confirmed the guard works.)
7. **Cancellation, through the real route**: cancelled a real in-flight execution -- `POST .../cancel` returned `{"status":"cancelled"}`, the DB row settled to `cancelled` (not stuck), and `gcloud run jobs executions describe` confirmed Cloud Run itself recorded `cancelledCount: 1`.
8. **New analysis after cancellation**: immediately after cancelling, `POST /api/avatar/analyze` again returned a brand-new `jobId` -- the guard released correctly, nothing left blocked.
9. **Durability across "devices"**: every poll in this test was an independent, stateless `curl` process with zero client-side memory -- this is a stronger proof of cross-device/reload durability than a single browser session would be, since there was no shared in-memory state to accidentally rely on. All state genuinely lives in Supabase.
10. **AutoRig/anatomical logic untouched**: `git diff origin/main..HEAD` on `autorig_avatar_v19.py`, `avatar_analyzer_v4.py`, `complete_avatar_rig_v10.py`, and `analyzer_v4_contract.py` is empty -- this migration never touched rig/anatomy logic, so gating behavior (BODY_BASIC vs. advanced profiles, blocking on insufficient evidence) is exactly what it was before, not re-derived from scratch.
11. Core pages (`/`, `/login`, `/biblioteca`, `/catalogo`, `/avatar-analyzer-v4`) all return 200 on the redeployed revision.

## Not verified -- real gaps, flagged rather than hidden

1. **Targeted reanalysis (hand/face/region)**: the worker still exposes `/avatar/analyze-v4/result/{run_id}/reanalyze`, but grepping the current Next.js app confirms **no route or frontend code calls it** -- only `/manual-corrections` exists as a related-but-different feature. This is a pre-existing gap in the product, not something this migration introduced or broke (`git diff` confirms none of the relevant files changed), but it means checklist items about verifying left/right-hand or face reanalysis through the app can't be exercised at all right now -- there's no UI or API path to it, on Railway or on Cloud Run.
2. **Visual/UI verification of the Analyzer 3D viewer, mobile layout, and the actual "cancel" button click** were not driven through a real browser -- verified the underlying API contract instead (which is what the frontend calls), not the rendered UI/UX itself. Recommend an actual browser click-through before or shortly after cutover, especially on mobile, since that's real UX surface this testing didn't touch.
3. **Multiple concurrent users** (as opposed to one user starting two overlapping requests) not tested -- only one test account was available.
