#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${CLOUVA_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:?Set CLOUVA_GCP_PROJECT or GOOGLE_CLOUD_PROJECT}}"
REGION="${CLOUVA_GCP_REGION:-us-central1}"
JOB_NAME="${CLOUVA_VIDEO_RENDER_JOB_NAME:-clouva-video-render}"
IMAGE="${CLOUVA_VIDEO_RENDER_IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/clouva-workers/video-render:latest}"

gcloud builds submit worker/video-render --project "${PROJECT_ID}" --tag "${IMAGE}"

if gcloud run jobs describe "${JOB_NAME}" --project "${PROJECT_ID}" --region "${REGION}" >/dev/null 2>&1; then
  gcloud run jobs update "${JOB_NAME}" \
    --project "${PROJECT_ID}" --region "${REGION}" --image "${IMAGE}" \
    --task-timeout=3600 --max-retries=1
else
  gcloud run jobs create "${JOB_NAME}" \
    --project "${PROJECT_ID}" --region "${REGION}" --image "${IMAGE}" \
    --task-timeout=3600 --max-retries=1
fi
