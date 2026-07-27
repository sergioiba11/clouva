# Avatar Analyzer V4.1 hardening

This document records the production contract introduced by PR #238.

## Result persistence

- Durable evidence is built and validated in a local staging directory.
- `avatar_analysis.json`, `diagnostic_report.json`, and `diagnostic_landmarks.glb` are required before publication.
- `expires_at.json` is written only after the destination tree is fully published and acts as the completion marker.
- Markerless directories are treated as in-progress during the grace period and as abandoned only after that period.
- Readers receive structured HTTP 503 with `ANALYZER_RESULT_STILL_PERSISTING` and `Retry-After` while publication is incomplete.

## Public response

- The immutable persisted analysis remains complete.
- The public response removes raw detector attempts, subprocess logs, duplicate accepted/rejected landmark maps, and `.npy` assets.
- Next.js reconstructs accepted and rejected landmarks from `analysis.landmarks`.
- The response is measured and constrained to a 24 MiB public payload budget.

## Recovery

- The active job is stored in `user_avatars.metadata.avatar_analyzer_v4_pending` as well as local storage.
- Completion atomically replaces the pending record with `avatar_analyzer_v4` and its compact summary.
- The latest-analysis endpoint can recover a pending job or a completed run from another device.
- Summary, diagnostic GLB, and full detail have independent frontend states; a temporary detail failure does not invalidate a usable result.

## Hands

- Hand camera orientation is derived from the local hand point cloud with 2D PCA perpendicular to wrist-to-distal direction.
- The world-front heuristic remains only as a sign/fallback reference.
- Hand framing is tightened to increase detector pixel coverage without changing body or face cameras.

## Deployment gate

The change is not considered production-verified until:

1. GitHub CI completes, including the Blender Worker Docker build.
2. The worker is deployed through `.github/workflows/deploy-blender-worker.yml`.
3. A real analysis is executed using the avatar that previously produced 0/7 left-hand and 1/7 right-hand detections.
4. Response size and hand detection before/after values are recorded.
5. Mobile layouts are captured at 360x800, 390x844, and 412x915.

## Rollback

Revert the PR merge commit and redeploy `clouva-blender-worker`. The source GLB and persisted complete `avatar_analysis.json` files remain immutable and are not rewritten by this hardening layer.
