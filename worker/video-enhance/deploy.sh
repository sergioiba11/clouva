#!/usr/bin/env bash
# L4 deployment profile; model image is reused across deploy-only changes.
set -euo pipefail

PROJECT_ID="${CLOUVA_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-gen-lang-client-0737053175}}"
REGION="${CLOUVA_VIDEO_ENHANCE_REGION:-us-central1}"
JOB_NAME="${CLOUVA_VIDEO_ENHANCE_JOB_NAME:-clouva-video-enhance-gpu}"
IMAGE="${CLOUVA_VIDEO_ENHANCE_IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/clouva/video-enhance:latest}"
GPU_TYPE="${CLOUVA_VIDEO_ENHANCE_GPU_TYPE:-nvidia-l4}"
SERVICE_ACCOUNT="${CLOUVA_VIDEO_ENHANCE_SERVICE_ACCOUNT:-clouva-web-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"

CPU=4
MEMORY=16Gi

gcloud builds submit worker/video-enhance --project "${PROJECT_ID}" --tag "${IMAGE}"

COMMON=(
  --project "${PROJECT_ID}" --region "${REGION}" --image "${IMAGE}"
  --service-account "${SERVICE_ACCOUNT}"
  --cpu "${CPU}" --memory "${MEMORY}"
  --gpu 1 --gpu-type "${GPU_TYPE}" --parallelism 1 --no-gpu-zonal-redundancy
  --task-timeout 3600 --max-retries 0
  --set-env-vars "SUPABASE_URL=https://dpawotcignpexkirhfsk.supabase.co,CLOUVA_GENERATED_MEDIA_BUCKET=clouva-generated-media"
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=clouva-supabase-service-role-key:latest"
)

if gcloud run jobs describe "${JOB_NAME}" --project "${PROJECT_ID}" --region "${REGION}" >/dev/null 2>&1; then
  gcloud run jobs update "${JOB_NAME}" "${COMMON[@]}"
else
  gcloud run jobs create "${JOB_NAME}" "${COMMON[@]}"
fi
