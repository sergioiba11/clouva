#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${CLOUVA_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-gen-lang-client-0737053175}}"
REGION="${CLOUVA_GCP_REGION:-us-central1}"
SERVICE="${CLOUVA_VIDEO_WEB_SERVICE:-clouva-web}"
JOB="${CLOUVA_VIDEO_RENDER_JOB_NAME:-clouva-video-render}"
BUCKET="${CLOUVA_GENERATED_MEDIA_BUCKET:-clouva-generated-media}"
ARTIFACT_REPOSITORY="${CLOUVA_VIDEO_ARTIFACT_REPOSITORY:-clouva}"
IMAGE_TAG="${CLOUVA_VIDEO_RENDER_TAG:-${GITHUB_SHA:-latest}}"
IMAGE="${CLOUVA_VIDEO_RENDER_IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/video-render:${IMAGE_TAG}}"

command -v gcloud >/dev/null || { echo "gcloud es requerido" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 es requerido" >&2; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null
echo "Reusing CLOUVA production APIs, Cloud Tasks queue, runtime IAM and worker secret."

SERVICE_JSON="$(mktemp)"
trap 'rm -f "$SERVICE_JSON"' EXIT

gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format=json > "$SERVICE_JSON"

SERVICE_ACCOUNT="$(python3 - "$SERVICE_JSON" <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
print(data.get("spec",{}).get("template",{}).get("spec",{}).get("serviceAccountName",""))
PY
)"
if [[ -z "$SERVICE_ACCOUNT" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

SUPABASE_URL="$(python3 - "$SERVICE_JSON" <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
env=(data.get("spec",{}).get("template",{}).get("spec",{}).get("containers") or [{}])[0].get("env") or []
for key in ("NEXT_PUBLIC_SUPABASE_URL","SUPABASE_URL"):
    for item in env:
        if item.get("name")==key and isinstance(item.get("value"), str) and item["value"]:
            print(item["value"])
            raise SystemExit
PY
)"
[[ -n "$SUPABASE_URL" ]] || { echo "No se pudo resolver SUPABASE_URL desde clouva-web." >&2; exit 1; }

SUPABASE_SECRET_NAME="$(python3 - "$SERVICE_JSON" <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
env=(data.get("spec",{}).get("template",{}).get("spec",{}).get("containers") or [{}])[0].get("env") or []
for item in env:
    if item.get("name")!="SUPABASE_SERVICE_ROLE_KEY":
        continue
    ref=(item.get("valueFrom") or {}).get("secretKeyRef") or {}
    if ref.get("name"):
        print(ref["name"])
        raise SystemExit
PY
)"
[[ -n "$SUPABASE_SECRET_NAME" ]] || {
  echo "SUPABASE_SERVICE_ROLE_KEY no está respaldada por Secret Manager en clouva-web." >&2
  exit 1
}

echo "Cloud Run service account: $SERVICE_ACCOUNT"
echo "Render job: $JOB"
echo "Worker image: $IMAGE"

# Reuse the existing Artifact Registry repository used by CLOUVA.
gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" \
  --project "$PROJECT_ID" \
  --location "$REGION" >/dev/null

# Cloud Build is already the canonical image builder used by CLOUVA deployments.
BUILD_ID="$(gcloud builds submit \
  --project "$PROJECT_ID" \
  --config cloudbuild-video-render.yaml \
  --substitutions="_VIDEO_RENDER_TAG=${IMAGE_TAG}" \
  --async \
  --format='value(id)' \
  .)"
[[ -n "$BUILD_ID" ]] || { echo "Cloud Build no devolvió build id." >&2; exit 1; }
echo "Cloud Build submitted: $BUILD_ID"

IMAGE_READY=0
for attempt in $(seq 1 72); do
  if gcloud artifacts docker images describe "$IMAGE" \
    --project "$PROJECT_ID" \
    --format='value(image_summary.digest)' >/tmp/video-render-digest 2>/dev/null; then
    if [[ -s /tmp/video-render-digest ]]; then
      IMAGE_READY=1
      break
    fi
  fi
  sleep 5
done
if [[ "$IMAGE_READY" != "1" ]]; then
  echo "La imagen del worker no apareció en Artifact Registry." >&2
  gcloud builds describe "$BUILD_ID" --project "$PROJECT_ID" --format='value(status)' || true
  exit 1
fi
echo "Render worker image ready: $IMAGE @ $(cat /tmp/video-render-digest)"

JOB_ARGS=(
  --project "$PROJECT_ID"
  --region "$REGION"
  --image "$IMAGE"
  --service-account "$SERVICE_ACCOUNT"
  --task-timeout=3600
  --max-retries=1
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL},CLOUVA_GENERATED_MEDIA_BUCKET=${BUCKET}"
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SECRET_NAME}:latest"
)

if gcloud run jobs describe "$JOB" --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB" "${JOB_ARGS[@]}"
else
  gcloud run jobs create "$JOB" "${JOB_ARGS[@]}"
fi

gcloud run jobs describe "$JOB" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(metadata.name)' | grep -q "$JOB"

echo
printf 'CLOUVA Cloud Video Engine render infra lista.\nProject: %s\nRegion: %s\nRender job: %s\nBucket: gs://%s\n' \
  "$PROJECT_ID" "$REGION" "$JOB" "$BUCKET"
