# Railway Volume → GCS Migration Report (Phase 9)

Date: 2026-07-28/29.

## Source located

The mega-prompt's "Railway volume `clouva-volume`" is a **separate, legacy** Railway service from the one migrated to Cloud Run: project `unique-trust` (`439c3eec-8467-48ac-ac59-081fd53aeaab`), service `clouva` (`9f64c3af-7c82-4937-840f-32eccbee4307`), custom domain `rig.clouva.com.ar`, same repo/`worker/garment-rig` source as the Cloud Run worker but deployed independently by Railway's own git integration (auto-deploys on push to `main`). It has a volume mounted at `/data` (volume id `4a287dc0-a3f9-49c6-a810-fa243dc94013`) — this is the actual target, not the Cloud Run worker (which already uses GCS natively via GCSFuse).

## Inventory (before migrating)

`GET /diagnostics/avatar-analyzer-v4-storage-inventory` on `rig.clouva.com.ar`:

- 6 run directories, 0 incomplete/abandoned runs.
- `results_json`: 12 files / 68.0 MB, `glb_diagnostic`: 6 / 14.4 MB, `glb_source`: 6 / 19.8 MB, `renders`: 4278 / 258.1 MB, `expiry_marker`: 6, `other`: 36 / 3.2 MB.

## Getting the migration endpoint to actually respond

The endpoint requires `X-Migration-Token` to match `CLOUVA_MIGRATION_TOKEN`. Generated a fresh token and set it via the Railway API (`set-variables`) -- but two attempts still 403'd. Root cause: **this Railway service had never picked up the variable change** -- `deploy` logs showed the exact same container ("Starting Container" once at 15:49) serving every request from 15:49 through 01:21, across three separate variable-set attempts, none of which actually restarted it (Railway's variable-triggered redeploy did not fire for this service for reasons not fully understood -- possibly related to `restartPolicyType: NEVER`). Also discovered along the way: the most recent git-triggered deploy (commit `61de994`, switching the migration to a background job) had status `SKIPPED` in Railway's own deployment history -- consistent with this session's very first commits ("Retrigger Railway deploy (previous push was skipped by Railway's queue)"), a known-flaky Railway queue behavior, not something introduced now.

**Fixed** with `railway redeploy --from-source`, forcing a real fresh build+deploy from `main` (commit `3f1fc7b`, the current tip) -- this both picked up the new token and got the async/background-job version of the migration endpoint. After that, the token worked immediately.

## Migration run

`POST /diagnostics/avatar-analyzer-v4-migrate-to-gcs` with `{"bucket": "clouva-avatar-analyzer-cache"}` (default `destination_prefix: railway-volume-migration`, deliberately *not* `avatar-analyzer-runs` -- keeps historical/legacy data clearly separated from the live run cache path the Cloud Run worker actually serves from, rather than silently merging old and new run IDs into the same namespace).

`migrationJobId: 299d972cddc74e48a2bb6c1278cb7336`. Polled to completion:

```json
{
  "status": "done",
  "bucket": "clouva-avatar-analyzer-cache",
  "destinationPrefix": "railway-volume-migration",
  "filesConsidered": 4344,
  "uploaded": {"count": 0, "bytes": 0},
  "skippedIdentical": {"count": 4344, "bytes": 363461837},
  "failures": []
}
```

**Every one of the 4344 files was already present in GCS with a matching sha256** -- this data had already been migrated in an earlier session (before this one started); this run is effectively the required **idempotency re-run**, and it passed: 0 uploads needed, 0 failures, 100% match, confirming the earlier migration's integrity rather than just re-doing it. ~363 MB total.

## Verification

- `gcloud storage ls` under `railway-volume-migration/`: 6 run directories, matching the pre-migration inventory count exactly.
- Spot-checked run `1796d831f26444c184ca80413d85ab17`: downloaded `avatar_analysis.json` (parses as valid JSON, `runId` field matches the directory name, has the expected top-level keys) and `diagnostic_landmarks.glb` (starts with the `glTF` magic header -- valid binary glTF). Every run has all 4 required files (`avatar_analysis.json`, `diagnostic_report.json`, `diagnostic_landmarks.glb`, `expires_at.json`) plus renders and detector debug JSON.
- Per-file integrity beyond the spot check comes from the migration endpoint's own built-in verification: `crc32c` checksum during upload plus a `sha256` comparison read back from GCS object metadata after each upload -- this is what the idempotency re-run's 4344/4344 "identical" match is actually checking.

## Not done (deliberately)

**Did not delete `clouva-volume` or stop the Railway `unique-trust/clouva` service.** Per the migration plan, that only happens after Phase 15 cutover and a final round of verification -- this data is preserved as-is on Railway for now, GCS has a verified independent copy.
