#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
APP_ROOT=/opt/clouva-analyzer
REPO_DIR="$APP_ROOT/repo"
LAB_DIR="$REPO_DIR/analyzer/anatomy-lab"
VENV="$APP_ROOT/venv"
BRANCH=workspace-official-v1
REPO_URL=https://github.com/sergioiba11/clouva.git

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git python3 python3-venv python3-pip \
  nodejs npm caddy libgl1 libglib2.0-0 libgomp1

if ! id clouva >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_ROOT" --shell /bin/bash clouva
fi
mkdir -p "$APP_ROOT"
chown -R clouva:clouva "$APP_ROOT"

if [ ! -d "$REPO_DIR/.git" ]; then
  sudo -u clouva git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$REPO_DIR"
else
  sudo -u clouva git -C "$REPO_DIR" fetch origin "$BRANCH"
  sudo -u clouva git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
fi

mkdir -p "$LAB_DIR/input" "$LAB_DIR/output" "$LAB_DIR/backend/models"
chown -R clouva:clouva "$LAB_DIR/input" "$LAB_DIR/output" "$LAB_DIR/backend/models"

if [ ! -x "$VENV/bin/python" ]; then
  sudo -u clouva python3 -m venv "$VENV"
fi
sudo -u clouva "$VENV/bin/python" -m pip install --disable-pip-version-check --upgrade pip
sudo -u clouva "$VENV/bin/python" -m pip install --disable-pip-version-check -r "$LAB_DIR/backend/requirements.txt"

fetch_model() {
  local url="$1"
  local target="$2"
  if [ ! -s "$target" ]; then
    sudo -u clouva curl --fail --location --retry 5 --retry-all-errors "$url" --output "$target"
  fi
  test -s "$target"
}
fetch_model "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" "$LAB_DIR/backend/models/pose_landmarker.task"
fetch_model "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" "$LAB_DIR/backend/models/face_landmarker.task"
fetch_model "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" "$LAB_DIR/backend/models/hand_landmarker.task"

cd "$LAB_DIR/frontend"
sudo -u clouva npm ci

cat >/etc/systemd/system/clouva-analyzer-backend.service <<EOF
[Unit]
Description=CLOUVA Analyzer Lab backend dev server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=clouva
WorkingDirectory=$LAB_DIR/backend
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/clouva-analyzer-frontend.service <<EOF
[Unit]
Description=CLOUVA Analyzer Lab Vite dev server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=clouva
WorkingDirectory=$LAB_DIR/frontend
Environment=VITE_ANALYZER_API_PORT=443
Environment=CHOKIDAR_USEPOLLING=true
ExecStart=/usr/bin/npm run dev -- --host 127.0.0.1 --port 3000
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat >/usr/local/bin/clouva-analyzer-sync <<'EOF'
#!/bin/bash
set -euo pipefail
APP_ROOT=/opt/clouva-analyzer
REPO_DIR="$APP_ROOT/repo"
LAB_DIR="$REPO_DIR/analyzer/anatomy-lab"
VENV="$APP_ROOT/venv"
BRANCH=workspace-official-v1

cd "$REPO_DIR"
git fetch -q origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && exit 0

OLD_REQ="$(sha256sum "$LAB_DIR/backend/requirements.txt" 2>/dev/null | awk '{print $1}')"
OLD_LOCK="$(sha256sum "$LAB_DIR/frontend/package-lock.json" 2>/dev/null | awk '{print $1}')"
git reset --hard "origin/$BRANCH"
NEW_REQ="$(sha256sum "$LAB_DIR/backend/requirements.txt" 2>/dev/null | awk '{print $1}')"
NEW_LOCK="$(sha256sum "$LAB_DIR/frontend/package-lock.json" 2>/dev/null | awk '{print $1}')"

if [ "$OLD_REQ" != "$NEW_REQ" ]; then
  "$VENV/bin/python" -m pip install --disable-pip-version-check -r "$LAB_DIR/backend/requirements.txt"
fi
if [ "$OLD_LOCK" != "$NEW_LOCK" ]; then
  cd "$LAB_DIR/frontend"
  npm ci
fi
logger -t clouva-analyzer-sync "Analyzer synced $LOCAL -> $REMOTE"
EOF
chmod +x /usr/local/bin/clouva-analyzer-sync
chown clouva:clouva /usr/local/bin/clouva-analyzer-sync

cat >/etc/systemd/system/clouva-analyzer-sync.service <<EOF
[Unit]
Description=Sync CLOUVA Analyzer Lab source from GitHub
After=network-online.target

[Service]
Type=oneshot
User=clouva
ExecStart=/usr/local/bin/clouva-analyzer-sync
EOF

cat >/etc/systemd/system/clouva-analyzer-sync.timer <<EOF
[Unit]
Description=Continuously sync CLOUVA Analyzer Lab source

[Timer]
OnBootSec=20s
OnUnitActiveSec=10s
AccuracySec=2s
Unit=clouva-analyzer-sync.service

[Install]
WantedBy=timers.target
EOF

EXTERNAL_IP="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)"
DOMAIN="${EXTERNAL_IP}.sslip.io"
cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode zstd gzip
  @backend path /api/* /health
  handle @backend {
    reverse_proxy 127.0.0.1:8000
  }
  handle {
    reverse_proxy 127.0.0.1:3000
  }
}
EOF

systemctl daemon-reload
systemctl enable --now clouva-analyzer-backend.service
systemctl enable --now clouva-analyzer-frontend.service
systemctl enable --now clouva-analyzer-sync.timer
systemctl restart caddy

for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null && curl -fsS http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  sleep 2
done

echo "CLOUVA Analyzer persistent dev runtime: https://$DOMAIN" >/etc/clouva-analyzer-runtime
