#!/bin/sh
set -eu

python -m uvicorn main:app --app-dir /app/backend --host 127.0.0.1 --port 8000 &
UVICORN_PID=$!

cleanup() {
  kill "$UVICORN_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

exec nginx -g 'daemon off;'
