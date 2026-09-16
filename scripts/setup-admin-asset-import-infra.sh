#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${CLOUVA_ASSET_IMPORT_TASKS_PROJECT:-gen-lang-client-0737053175}"
REGION="${CLOUVA_ASSET_IMPORT_TASKS_LOCATION:-us-central1}"
QUEUE="${CLOUVA_ASSET_IMPORT_TASKS_QUEUE:-clouva-asset-imports}"
SERVICE="${CLOUVA_ASSET_IMPORT_SERVICE:-clouva-web}"
BUCKET="${CLOUVA_ADMIN_ASSETS_BUCKET:-clouva-generated-media}"
APP_ORIGIN="${CLOUVA_APP_ORIGIN:-https://clouva.com.ar}"
WORKER_URL="${CLOUVA_ASSET_IMPORT_WORKER_URL:-https://clouva.com.ar/api/internal/admin/assets/imports/process}"
SECRET_NAME="${CLOUVA_ASSET_IMPORT_WORKER_SECRET_NAME:-clouva-asset-import-worker-secret}"

command -v gcloud >/dev/null || { echo "gcloud es requerido" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 es requerido" >&2; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable \
  cloudtasks.googleapis.com \
  run.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT_ID"

if ! gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud tasks queues create "$QUEUE" \
    --location "$REGION" \
    --project "$PROJECT_ID" \
    --log-sampling-ratio=1.0
fi

SERVICE_ACCOUNT="$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(spec.template.spec.serviceAccountName)')"

if [[ -z "$SERVICE_ACCOUNT" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

echo "Cloud Run service account: $SERVICE_ACCOUNT"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/cloudtasks.enqueuer" \
  --condition=None >/dev/null

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/storage.objectAdmin" >/dev/null

if ! gcloud secrets describe "$SECRET_NAME" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET_NAME" --project "$PROJECT_ID" --replication-policy=automatic
fi

if [[ -n "${CLOUVA_ASSET_IMPORT_WORKER_SECRET_VALUE:-}" ]]; then
  printf '%s' "$CLOUVA_ASSET_IMPORT_WORKER_SECRET_VALUE" | \
    gcloud secrets versions add "$SECRET_NAME" --project "$PROJECT_ID" --data-file=- >/dev/null
else
  VERSION_COUNT="$(gcloud secrets versions list "$SECRET_NAME" --project "$PROJECT_ID" --filter='state=ENABLED' --format='value(name)' | wc -l | tr -d ' ')"
  if [[ "$VERSION_COUNT" == "0" ]]; then
    echo "Falta crear el valor secreto." >&2
    echo "Ejecutá de nuevo con CLOUVA_ASSET_IMPORT_WORKER_SECRET_VALUE definido." >&2
    exit 1
  fi
fi

gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

CURRENT_BUCKET_JSON="$(mktemp)"
MERGED_CORS_JSON="$(mktemp)"
trap 'rm -f "$CURRENT_BUCKET_JSON" "$MERGED_CORS_JSON"' EXIT

gcloud storage buckets describe "gs://${BUCKET}" --format=json > "$CURRENT_BUCKET_JSON"
python3 - "$CURRENT_BUCKET_JSON" "$MERGED_CORS_JSON" "$APP_ORIGIN" <<'PY'
import json, sys
source, output, origin = sys.argv[1:]
data = json.load(open(source, encoding="utf-8"))
rules = data.get("cors") or []
required = {
    "origin": [origin],
    "method": ["PUT"],
    "responseHeader": ["Content-Type", "Range", "ETag"],
    "maxAgeSeconds": 3600,
}

def covers(rule):
    origins = set(rule.get("origin") or [])
    methods = set(rule.get("method") or [])
    headers = {str(value).lower() for value in (rule.get("responseHeader") or [])}
    return (origin in origins or "*" in origins) and "PUT" in methods and "range" in headers

if not any(covers(rule) for rule in rules):
    rules.append(required)
json.dump(rules, open(output, "w", encoding="utf-8"), indent=2)
PY

gcloud storage buckets update "gs://${BUCKET}" --cors-file="$MERGED_CORS_JSON" >/dev/null

gcloud run services update "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --timeout=1800 \
  --update-env-vars="CLOUVA_ADMIN_ASSETS_BUCKET=${BUCKET},CLOUVA_ASSET_IMPORT_TASKS_PROJECT=${PROJECT_ID},CLOUVA_ASSET_IMPORT_TASKS_LOCATION=${REGION},CLOUVA_ASSET_IMPORT_TASKS_QUEUE=${QUEUE},CLOUVA_ASSET_IMPORT_WORKER_URL=${WORKER_URL}" \
  --update-secrets="CLOUVA_ASSET_IMPORT_WORKER_SECRET=${SECRET_NAME}:latest" \
  --quiet

echo
printf 'Asset import infra lista.\nProject: %s\nQueue: %s/%s\nBucket: gs://%s\nWorker: %s\n' \
  "$PROJECT_ID" "$REGION" "$QUEUE" "$BUCKET" "$WORKER_URL"
