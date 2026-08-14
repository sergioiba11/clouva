#!/bin/bash
set -euo pipefail

ROOT=/runtime
REPO_DIR="$ROOT/repo"
LAB_DIR="$REPO_DIR/$LAB_PATH"
VENV=/opt/venv
SYNC_SECONDS="${SYNC_SECONDS:-10}"

mkdir -p "$ROOT"
nginx

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
fi

prepare_runtime() {
  mkdir -p "$LAB_DIR/input" "$LAB_DIR/output" "$LAB_DIR/backend/models"
  cp -f /opt/mediapipe-models/*.task "$LAB_DIR/backend/models/"
  "$VENV/bin/python" -m pip install --disable-pip-version-check -r "$LAB_DIR/backend/requirements.txt"
  (cd "$LAB_DIR/frontend" && npm ci)
}

prepare_runtime

backend_loop() {
  while true; do
    cd "$LAB_DIR/backend"
    "$VENV/bin/python" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload || true
    sleep 2
  done
}

frontend_loop() {
  while true; do
    cd "$LAB_DIR/frontend"
    VITE_ANALYZER_API_PORT=443 CHOKIDAR_USEPOLLING=true npm run dev -- --host 127.0.0.1 --port 3000 || true
    sleep 2
  done
}

sync_loop() {
  while true; do
    sleep "$SYNC_SECONDS"
    cd "$REPO_DIR"
    git fetch -q origin "$BRANCH" || continue
    local_sha="$(git rev-parse HEAD)"
    remote_sha="$(git rev-parse "origin/$BRANCH")"
    if [ "$local_sha" = "$remote_sha" ]; then
      continue
    fi

    old_req="$(sha256sum "$LAB_DIR/backend/requirements.txt" 2>/dev/null | awk '{print $1}')"
    old_lock="$(sha256sum "$LAB_DIR/frontend/package-lock.json" 2>/dev/null | awk '{print $1}')"
    git reset --hard "origin/$BRANCH"
    mkdir -p "$LAB_DIR/input" "$LAB_DIR/output" "$LAB_DIR/backend/models"
    cp -f /opt/mediapipe-models/*.task "$LAB_DIR/backend/models/"
    new_req="$(sha256sum "$LAB_DIR/backend/requirements.txt" 2>/dev/null | awk '{print $1}')"
    new_lock="$(sha256sum "$LAB_DIR/frontend/package-lock.json" 2>/dev/null | awk '{print $1}')"

    if [ "$old_req" != "$new_req" ]; then
      "$VENV/bin/python" -m pip install --disable-pip-version-check -r "$LAB_DIR/backend/requirements.txt" || true
    fi
    if [ "$old_lock" != "$new_lock" ]; then
      (cd "$LAB_DIR/frontend" && npm ci) || true
    fi
    echo "[clouva-analyzer-dev] synced $local_sha -> $remote_sha"
  done
}

backend_loop &
BACKEND_PID=$!
frontend_loop &
FRONTEND_PID=$!
sync_loop &
SYNC_PID=$!

trap 'kill "$BACKEND_PID" "$FRONTEND_PID" "$SYNC_PID" 2>/dev/null || true; nginx -s quit || true' TERM INT EXIT

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then backend_loop & BACKEND_PID=$!; fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then frontend_loop & FRONTEND_PID=$!; fi
  if ! kill -0 "$SYNC_PID" 2>/dev/null; then sync_loop & SYNC_PID=$!; fi
  sleep 5
done
