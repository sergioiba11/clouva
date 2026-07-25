# Clouva

Production app for sergioiba11: public storefront + admin panel + owner-only "Mi Flow", plus a 3D avatar/garment pipeline (Blender worker + MediaPipe) that analyzes a user's uploaded avatar and rigs/fits garments onto it. Next.js + TypeScript + Tailwind + Supabase, deployed to Vercel (`clouva.com.ar`); the heavy Blender/analysis workers run on Google Cloud Run (project `gen-lang-client-0737053175`, region `us-central1`).

## Where things stand (2026-07-25)

Active work is on [PR #235](https://github.com/sergioiba11/clouva/pull/235) (branch `claude/proyecto-retomado-21467b`), not yet merged:

1. Fixed an intermittent 500 on `GET /avatar/analyze-v4/result/{run_id}` — Cloud Run's hard 32MB response-size limit was being hit because `_public_result` in `worker/garment-rig/app_v18.py` duplicated the full landmarks dict and embedded raw pre-triangulation detector output that no frontend consumer reads. Fixed by trimming the public response only (the persisted `avatar_analysis.json` on disk is untouched). **Deployed** to `clouva-blender-worker` on Cloud Run, **not yet verified** against a real large analysis run end-to-end.
2. Added `.gitattributes` forcing LF on `*.sh` — a CRLF checkout on Windows was corrupting `worker/garment-rig/blender-headless.sh`'s shebang and breaking the Cloud Build step that execs it.
3. Added `.github/workflows/deploy-blender-worker.yml`: deploys `clouva-blender-worker` to Cloud Run on push to `main` (when `worker/garment-rig/**` changes) or via a manual `workflow_dispatch` (usable from the GitHub app on mobile, no local `gcloud` needed). Auth is Workload Identity Federation — no stored keys — via service account `github-actions-deployer@gen-lang-client-0737053175.iam.gserviceaccount.com`, scoped to this repo only.

**Multi-device note:** a session started from the Claude Code mobile app clones this repo fresh from GitHub — it has no access to any given local machine, its local sessions, or its local `gcloud` credentials. That's the whole reason the GitHub Actions deploy workflow above exists: it lets any session (mobile included) trigger a real Cloud Run deploy without needing a specific PC.

Before assuming the above is still accurate, check `gh pr view 235` (or the current state of that branch/PR — it may have merged or moved on since this was written).
