# Operations Guide

## Where things are

- Project: `gen-lang-client-0737053175`, region `us-central1`.
- Supabase project: `dpawotcignpexkirhfsk` (unchanged by this migration).
- Dashboard: Cloud Monitoring dashboard `projects/37640598175/dashboards/5680b2aa-759d-4946-b0de-557790b2b361` ("CLOUVA — Google Cloud overview").
- Alerts go to: email notification channel -> sergio.iba.11@gmail.com.
- Billing budget: $50/mo on account `011EFA-27A3E3-A98ACB`, scoped to this project only. **Placeholder figure, not researched against real usage** -- revisit after a few weeks of real traffic.

## Checking health

```bash
curl https://clouva-web-37640598175.us-central1.run.app/api/health
curl https://clouva-blender-worker-37640598175.us-central1.run.app/diagnostics/avatar-analyzer-v4
curl https://clouva-mediapipe-detector-37640598175.us-central1.run.app/health
gcloud run jobs executions list --project gen-lang-client-0737053175 --region us-central1 --job clouva-avatar-analyzer --limit 5
```

Or just run `verify-production.yml` via manual dispatch for all four at once.

## Investigating a stuck or failed Analyzer job

```sql
select id, status, phase, error_code, error_message, cloud_run_execution, created_at, started_at, finished_at
from avatar_analyzer_jobs
where status not in ('completed','failed','cancelled')
order by created_at desc;
```

If a row is stuck non-terminal with no recent `updated_at` movement and its `cloud_run_execution` shows the Cloud Run execution itself already finished/failed/cancelled (`gcloud run jobs executions describe <name>`), the row can be manually finalized -- this exact scenario (execution cancelled during cold start, before the entrypoint ever ran) is what `finalizeAnalyzerJobCancellation` now handles automatically for the cancel path; a stuck `failed`-but-not-marked row from some other cause would need the same kind of manual `UPDATE ... SET status = 'failed', error_code = 'MANUALLY_RECONCILED', ...` treatment.

## Logs

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="clouva-web"' --limit 50 --project gen-lang-client-0737053175
gcloud run jobs executions describe <execution-name> --project gen-lang-client-0737053175 --region us-central1
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="clouva-avatar-analyzer"' --limit 100 --project gen-lang-client-0737053175
```

## Cost drivers, roughly

- `clouva-avatar-analyzer` Job (4 vCPU / 8Gi) -- scales with how many analyses actually run; each real run observed during this migration's testing took ~1-2 minutes of Blender processing plus ~2 minutes of cold start per execution.
- `clouva-blender-worker` (4 vCPU / 8Gi, `--no-cpu-throttling`) -- idle-capable (min-instances not pinned to 1 in this migration; confirm current setting before assuming steady-state cost), but `--no-cpu-throttling` means any warm instance bills for full CPU even between requests.
- Cloud Run services otherwise scale to zero when idle (`clouva-web`, `clouva-mediapipe-detector`).
- Load Balancer: fixed cost for the forwarding rules + the reserved global IP, independent of traffic.
- GCS storage: `clouva-avatar-analyzer-cache` -- grows with every run kept past its TTL (`CLOUVA_AVATAR_ANALYZER_RUN_TTL_SECONDS`, 30 days) plus the migrated Railway historical data (~363 MB, one-time).

No per-execution or per-request cost model was derived here (would need actual GCP billing export data, not available from this session) -- the $50/mo budget alert is the practical guardrail until real numbers exist.

## Secrets rotation

Each Secret Manager secret (`clouva-*`) supports adding a new version (`gcloud secrets versions add <name> --data-file=-`) without any code change -- every consumer references `:latest`. No redeploy needed for most; Cloud Run picks up the latest secret version on the *next* new revision, not on already-running instances, so rotate a secret then trigger a redeploy (even a no-op one) if immediate propagation matters.

## Fixing "Error de avatar: Failed to fetch" (missing bucket CORS)

The `feat(storage): route avatar/garment writes through a GCS-backed storage
service` change (commit `0f9326c`) switched avatar/garment reads to public
GLB/PNG URLs on `https://storage.googleapis.com/clouva-avatars/...`, fetched
directly by the browser (`GLTFLoader` in `AvatarModelViewer`). The bucket
itself is public-read (`gcloud storage ls` / plain `GET` works fine), but it
was never given a CORS policy -- confirmed via `OPTIONS` preflight against the
bucket returning no `Access-Control-Allow-*` headers. Browsers require CORS
for cross-origin `fetch()` (unlike `<img src>`), so every client-side avatar
load fails with `TypeError: Failed to fetch`, which is exactly the
`AvatarModelViewer` error banner ("Error de avatar: Failed to fetch") users
started seeing right after this migration -- not a data-loss or broken-file
issue, the GLBs in the bucket are intact.

Fix (one-time, requires `gcloud` access to `gen-lang-client-0737053175`):

```bash
gcloud storage buckets update gs://clouva-avatars \
  --cors-file=docs/migration/gcs-cors-clouva-avatars.json \
  --project gen-lang-client-0737053175
```

Verify:

```bash
curl -s -D - -o /dev/null -X OPTIONS "https://storage.googleapis.com/clouva-avatars/" \
  -H "Origin: https://clouva.com.ar" -H "Access-Control-Request-Method: GET" \
  | grep -i access-control-allow-origin
```

Same class of gap likely applies to any other bucket that gets fetched
client-side rather than just displayed via `<img>` -- check with the same
`OPTIONS` probe before assuming a "public" bucket is browser-usable.

## Known follow-ups (not blockers, tracked here so they don't get lost)

1. `clouva-blender-worker` / `clouva-mediapipe-detector` are still publicly invokable (`allUsers` on Cloud Run IAM) -- deliberately deferred until Railway is fully decommissioned (see [GCP_WORKER_MEDIAPIPE_VERIFICATION.md](GCP_WORKER_MEDIAPIPE_VERIFICATION.md)).
2. `SUPABASE_SERVICE_ROLE_KEY` on `clouva-blender-worker` is still a plaintext env var, not Secret-Manager-backed (unlike `clouva-web` and the Analyzer Job).
3. Targeted reanalysis (hand/face/region) has no route in the app at all -- pre-existing gap, not introduced by this migration.
4. Structured JSON logging across every log line (full field schema from the original migration brief) was not done -- Cloud Logging already captures structured metadata regardless of app-level log format; a full rewrite was judged disproportionate risk this late in the migration.
5. `$50/mo` billing budget is a placeholder.
6. `clouva-avatars` bucket had no CORS policy after the storage migration, breaking every client-side avatar load -- see "Fixing 'Error de avatar: Failed to fetch'" above. Fixed by applying `docs/migration/gcs-cors-clouva-avatars.json`; still needs someone with `gcloud` access to actually run the command against production if it hasn't been run yet.
