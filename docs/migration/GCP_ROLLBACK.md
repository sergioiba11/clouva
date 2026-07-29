# Rollback Plan

## Principle

Every deploy in this migration is by immutable image digest and keeps the previous revision/image around. Rolling back never means rebuilding — it means pointing traffic/DNS back at something that already exists and is already known-good. Supabase and GCS are never touched by a rollback; only Cloud Run traffic and DNS move.

## If DNS was just changed and something's wrong

1. **Revert the DNS A record** for `clouva.com.ar` back to Railway's value (`69.46.46.105` as of 2026-07-29 -- verify this is still current before using it, DNS may have changed). TTL was deliberately set to 300s at cutover so this propagates in minutes, not hours.
2. Railway is not stopped or deleted until well after cutover is confirmed stable (see [GCP_MIGRATION_REPORT.md](GCP_MIGRATION_REPORT.md) for the actual sequencing) -- so reverting DNS alone brings the site fully back to exactly how it was running seconds before cutover, no data loss, no rebuild needed.
3. Nothing created on the Google Cloud side (Load Balancer, `clouva-web`, `clouva-avatar-analyzer` Job, Secret Manager, GCS migration copy) needs to be torn down to roll back -- it's additive infrastructure, safe to leave running while investigating.

## If a bad `clouva-web` revision is live (post-cutover, DNS already stable on Google Cloud)

```bash
gcloud run services update-traffic clouva-web \
  --project gen-lang-client-0737053175 --region us-central1 \
  --to-revisions <previous-revision-name>=100
```

Every revision is deployed by digest and traffic is only shifted to 100% after `deploy-gcp-web.yml`'s own health check passes on a `--no-traffic` deploy first -- so "the previous revision" is always something that was independently verified healthy when it went live, not a guess.

## If a bad `clouva-blender-worker` revision is live

```bash
gcloud run services update-traffic clouva-blender-worker \
  --project gen-lang-client-0737053175 --region us-central1 \
  --to-revisions <previous-revision-name>=100
```

`deploy-blender-worker.yml` records the source commit + revision name of every successful deploy in its uploaded `deployment-status.json` artifact -- check recent workflow runs to find the last known-good revision name.

## If a bad `clouva-avatar-analyzer` Job image is live

```bash
gcloud run jobs update clouva-avatar-analyzer \
  --project gen-lang-client-0737053175 --region us-central1 \
  --image <previous-image-digest>
```

`deploy-blender-worker.yml` syncs the Job to the same digest as the Service on every successful deploy, so the previous Service revision's image digest is also the previous Job image. **Never roll back to an image digest by tag** (e.g. `:latest`) -- always use the exact `@sha256:...` digest so what runs is unambiguous.

Never roll back a Job mid-execution by deleting/recreating it -- in-flight executions on the old image keep running to completion (or get cancelled through the normal cancel flow) regardless of what the Job resource's default image points to next; only future executions pick up the new image.

## What a rollback must never do

- **Never revert by destroying results created after cutover.** Any Analyzer runs, avatar uploads, or orders that happened on Google Cloud after cutover are real user data -- a rollback moves traffic back to Railway, it does not delete or overwrite anything in Supabase or GCS.
- **Never touch Supabase schema as part of a rollback.** `avatar_analyzer_jobs` and its migrations are additive; the old Railway-hosted worker's local-file job state and this table can coexist (they're used by different, non-overlapping code paths) if a rollback puts Railway back in front.
- **Never delete GCS run data** as part of any rollback, ever, at any phase.
- **Never force-push or rewrite git history** to "undo" the migration. Revert via a new commit/PR if the migration itself needs to be reverted at the code level.

## Recovery time expectations

- DNS-only rollback (Railway still running): minutes (TTL 300s + propagation).
- Cloud Run traffic-split rollback: seconds (Cloud Run traffic changes are near-instant).
- Anything requiring a rebuild: only if a *fix* is needed, not for a rollback -- rollbacks in this plan are always "point at something that already exists and already passed its own health check," never "rebuild and hope."
