# CLOUVA Video AI on Runpod Serverless

This worker is the external-GPU backend for `/crear/video/pro`.

## Verified architecture

- CLOUVA web remains on Google Cloud Run.
- Supabase remains the source of truth for `video_enhance_jobs`.
- Input videos remain in `gs://clouva-generated-media`.
- That bucket is already public-read; Runpod only receives the source HTTPS URL.
- CLOUVA creates two GCS resumable upload sessions for the output MP4 and thumbnail.
- The Runpod worker receives those temporary session URLs and uploads directly to GCS.
- Runpod never receives a Google service-account key or Supabase service-role key.
- CLOUVA polls the Runpod queue API and reconciles completion/failure back into Supabase.

## Runpod endpoint

Use Runpod **Serverless → New Endpoint → Import Git Repository**.

Repository:
- `sergioiba11/clouva`

Production branch:
- `main`

Dockerfile path:
- `worker/video-enhance/Dockerfile.runpod`

Endpoint type:
- `Queue`

Recommended GPU pool:
- 48 GB tier: **A6000 / A40**
- Minimum active workers: `0`
- Maximum workers: `1` initially
- Execution timeout: `3600` seconds

The 48 GB tier is intentional. LTXV 2B memory use varies substantially with resolution; CLOUVA supports 720p output, so 24 GB is not treated as the production target.

## Model cache

Attach a Runpod network volume to the endpoint. The worker uses Runpod `VolumeCache` for:

`/root/.cache/huggingface`

Runpod mounts network volumes at `/runpod-volume`; when a volume is absent, `VolumeCache` degrades to a no-op and the worker still runs.

## CLOUVA web secrets

The Cloud Run web service needs only:

- `RUNPOD_API_KEY` — server-side secret.
- `RUNPOD_VIDEO_ENDPOINT_ID` — endpoint identifier.

Never expose the API key with `NEXT_PUBLIC_`.

## Request flow

```text
Browser
  -> CLOUVA /api/video/enhance
  -> GCS source upload / existing CLOUVA render
  -> CLOUVA creates resumable GCS output sessions
  -> POST https://api.runpod.ai/v2/<endpoint>/run
  -> Runpod LTXV 2B worker
  -> MP4 + thumbnail PUT directly to GCS
  -> CLOUVA polls /status/<runpod-job-id>
  -> Supabase job completed
  -> browser shows result
```
