#!/bin/sh
# Syncs the canonical detector logic from worker/garment-rig (single source of
# truth) into this directory, then deploys this directory to Cloud Run.
# Usage: PROJECT_ID=my-gcp-project ./deploy.sh
set -eu

cd "$(dirname "$0")"
cp ../garment-rig/landmark_detector_2d.py ./landmark_detector_2d.py

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID=your-gcp-project-id}"
SERVICE_NAME="${SERVICE_NAME:-clouva-mediapipe-detector}"
REGION="${REGION:-us-central1}"

gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source . \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 180 \
  --allow-unauthenticated \
  --set-env-vars "CLOUVA_MEDIAPIPE_SERVICE_TOKEN=${CLOUVA_MEDIAPIPE_SERVICE_TOKEN:?Set CLOUVA_MEDIAPIPE_SERVICE_TOKEN=a-random-secret}"

rm -f ./landmark_detector_2d.py
