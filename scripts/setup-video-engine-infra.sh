#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${CLOUVA_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-gen-lang-client-0737053175}}"
REGION="${CLOUVA_GCP_REGION:-us-central1}"
SERVICE="${CLOUVA_VIDEO_WEB_SERVICE:-clouva-web}"
QUEUE="${CLOUVA_VIDEO_QUEUE_NAME:-clouva-video-generation}"
JOB="${CLOUVA_VIDEO_RENDER_JOB_NAME:-clouva-video-render}"
BUCKET="${CLOUVA_GENERATED_MEDIA_BUCKET:-clouva-generated-media}"
APP_ORIGIN="${CLOUVA_APP_ORIGIN:-https://clouva.com.ar}"
TASK_SECRET_NAME="${CLOUVA_VIDEO_TASK_SECRET_NAME:-clouva-video-task-secret}"
ARTIFACT_REPOSITORY="${CLOUVA_VIDEO_ARTIFACT_REPOSITORY:-clouva-workers}"
IMAGE="${CLOUVA_VIDEO_RENDER_IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/video-render:latest}"

command -v gcloud >/dev/null || { echo "gcloud es requerido" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 es requerido" >&2; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable   aiplatform.googleapis.com   artifactregistry.googleapis.com   cloudbuild.googleapis.com   cloudtasks.googleapis.com   run.googleapis.com   secretmanager.googleapis.com   storage.googleapis.com   --project "$PROJECT_ID"

if ! gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud tasks queues create "$QUEUE"     --location "$REGION"     --project "$PROJECT_ID"     --log-sampling-ratio=1.0
fi

SERVICE_JSON="$(mktemp)"
BUCKET_JSON="$(mktemp)"
CORS_JSON="$(mktemp)"
trap 'rm -f "$SERVICE_JSON" "$BUCKET_JSON" "$CORS_JSON"' EXIT

gcloud run services describe "$SERVICE"   --project "$PROJECT_ID"   --region "$REGION"   --format=json > "$SERVICE_JSON"

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

SUPABASE_URL="${CLOUVA_SUPABASE_URL:-}"
if [[ -z "$SUPABASE_URL" ]]; then
  SUPABASE_URL="$(python3 - "$SERVICE_JSON" <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
env=(data.get("spec",{}).get("template",{}).get("spec",{}).get("containers") or [{}])[0].get("env") or []
for key in ("NEXT_PUBLIC_SUPABASE_URL","SUPABASE_URL"):
    for item in env:
        if item.get("name")==key and isinstance(item.get("value"), str):
            print(item["value"])
            raise SystemExit
PY
)"
fi
[[ -n "$SUPABASE_URL" ]] || { echo "No se pudo resolver SUPABASE_URL desde clouva-web. Definí CLOUVA_SUPABASE_URL." >&2; exit 1; }

SUPABASE_SECRET_NAME="${CLOUVA_SUPABASE_SERVICE_ROLE_SECRET_NAME:-}"
if [[ -z "$SUPABASE_SECRET_NAME" ]]; then
  SUPABASE_SECRET_NAME="$(python3 - "$SERVICE_JSON" <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
env=(data.get("spec",{}).get("template",{}).get("spec",{}).get("containers") or [{}])[0].get("env") or []
for item in env:
    if item.get("name")!="SUPABASE_SERVICE_ROLE_KEY":
        continue
    value_from=item.get("valueFrom") or {}
    secret_ref=value_from.get("secretKeyRef") or {}
    name=secret_ref.get("name")
    if name:
        print(name)
        raise SystemExit
PY
)"
fi
[[ -n "$SUPABASE_SECRET_NAME" ]] || {
  echo "No se pudo detectar el Secret Manager secret de SUPABASE_SERVICE_ROLE_KEY. Definí CLOUVA_SUPABASE_SERVICE_ROLE_SECRET_NAME." >&2
  exit 1
}

echo "Cloud Run service account: $SERVICE_ACCOUNT"
echo "Video queue: $QUEUE"
echo "Video render job: $JOB"

gcloud projects add-iam-policy-binding "$PROJECT_ID"   --member="serviceAccount:${SERVICE_ACCOUNT}"   --role="roles/cloudtasks.enqueuer"   --condition=None >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID"   --member="serviceAccount:${SERVICE_ACCOUNT}"   --role="roles/aiplatform.user"   --condition=None >/dev/null

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}"   --member="serviceAccount:${SERVICE_ACCOUNT}"   --role="roles/storage.objectAdmin" >/dev/null

if ! gcloud secrets describe "$TASK_SECRET_NAME" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "$TASK_SECRET_NAME" --project "$PROJECT_ID" --replication-policy=automatic
fi
if [[ -n "${CLOUVA_VIDEO_TASK_SECRET_VALUE:-}" ]]; then
  printf '%s' "$CLOUVA_VIDEO_TASK_SECRET_VALUE" |     gcloud secrets versions add "$TASK_SECRET_NAME" --project "$PROJECT_ID" --data-file=- >/dev/null
else
  VERSION_COUNT="$(gcloud secrets versions list "$TASK_SECRET_NAME" --project "$PROJECT_ID" --filter='state=ENABLED' --format='value(name)' | wc -l | tr -d ' ')"
  if [[ "$VERSION_COUNT" == "0" ]]; then
    python3 - <<'PY' | gcloud secrets versions add "$TASK_SECRET_NAME" --project "$PROJECT_ID" --data-file=- >/dev/null
import secrets
print(secrets.token_urlsafe(48), end="")
PY
  fi
fi

for SECRET_NAME in "$TASK_SECRET_NAME" "$SUPABASE_SECRET_NAME"; do
  gcloud secrets add-iam-policy-binding "$SECRET_NAME"     --project "$PROJECT_ID"     --member="serviceAccount:${SERVICE_ACCOUNT}"     --role="roles/secretmanager.secretAccessor" >/dev/null
done

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY"   --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY"     --project "$PROJECT_ID"     --location "$REGION"     --repository-format=docker     --description="CLOUVA cloud workers"
fi

gcloud builds submit worker/video-render   --project "$PROJECT_ID"   --tag "$IMAGE"

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

# The web service passes CLOUVA_VIDEO_PROJECT_ID as an execution-time override.
gcloud run jobs add-iam-policy-binding "$JOB"   --project "$PROJECT_ID"   --region "$REGION"   --member="serviceAccount:${SERVICE_ACCOUNT}"   --role="roles/run.jobsExecutorWithOverrides" >/dev/null

# Reuse the generated-media bucket for direct browser audio uploads. Preserve
# every existing CORS rule and only add the CLOUVA PUT capability if missing.
gcloud storage buckets describe "gs://${BUCKET}" --format=json > "$BUCKET_JSON"
python3 - "$BUCKET_JSON" "$CORS_JSON" "$APP_ORIGIN" <<'PY'
import json, sys
source, output, origin = sys.argv[1:]
data = json.load(open(source, encoding="utf-8"))
rules = data.get("cors") or []
required = {
    "origin": [origin],
    "method": ["PUT"],
    "responseHeader": ["Content-Type", "Content-Range", "Range", "ETag"],
    "maxAgeSeconds": 3600,
}
def covers(rule):
    origins=set(rule.get("origin") or [])
    methods=set(rule.get("method") or [])
    headers={str(v).lower() for v in (rule.get("responseHeader") or [])}
    return (origin in origins or "*" in origins) and "PUT" in methods and "range" in headers
if not any(covers(rule) for rule in rules):
    rules.append(required)
json.dump(rules, open(output, "w", encoding="utf-8"), indent=2)
PY
gcloud storage buckets update "gs://${BUCKET}" --cors-file="$CORS_JSON" >/dev/null

gcloud run services update "$SERVICE"   --project "$PROJECT_ID"   --region "$REGION"   --update-env-vars="APP_BASE_URL=${APP_ORIGIN},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},CLOUVA_GCP_PROJECT=${PROJECT_ID},CLOUVA_GCP_REGION=${REGION},VERTEX_VIDEO_LOCATION=${REGION},CLOUVA_VIDEO_QUEUE_NAME=${QUEUE},CLOUVA_VIDEO_RENDER_JOB_NAME=${JOB},CLOUVA_GENERATED_MEDIA_BUCKET=${BUCKET}"   --update-secrets="VIDEO_PROJECT_TASK_SECRET=${TASK_SECRET_NAME}:latest"   --quiet

echo
printf 'CLOUVA Cloud Video Engine infra lista.\nProject: %s\nRegion: %s\nQueue: %s\nRender job: %s\nBucket: gs://%s\nWeb service: %s\n'   "$PROJECT_ID" "$REGION" "$QUEUE" "$JOB" "$BUCKET" "$SERVICE"
