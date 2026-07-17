#!/bin/sh
set -eu

AVATAR_PATH="${CLOUVA_AVATAR_PATH:-/app/models/clouva-base-rig-v1.glb}"

if [ ! -s "$AVATAR_PATH" ]; then
  if [ -z "${CLOUVA_AVATAR_URL:-}" ]; then
    echo "Falta CLOUVA_AVATAR_URL para descargar el avatar oficial" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$AVATAR_PATH")"
  python - <<'PY'
import os
from pathlib import Path
from urllib.request import Request, urlopen

url = os.environ["CLOUVA_AVATAR_URL"]
target = Path(os.environ.get("CLOUVA_AVATAR_PATH", "/app/models/clouva-base-rig-v1.glb"))
token = os.environ.get("CLOUVA_AVATAR_TOKEN", "").strip()
headers = {"User-Agent": "CLOUVA-Garment-Worker/1.0"}
if token:
    headers["Authorization"] = f"Bearer {token}"

request = Request(url, headers=headers)
with urlopen(request, timeout=120) as response:
    data = response.read(100 * 1024 * 1024)

if data[:4] != b"glTF":
    raise SystemExit("CLOUVA_AVATAR_URL no devolvió un GLB válido")
if len(data) < 32:
    raise SystemExit("El avatar descargado está vacío o incompleto")

target.parent.mkdir(parents=True, exist_ok=True)
temporary = target.with_suffix(".download")
temporary.write_bytes(data)
temporary.replace(target)
print(f"Avatar CLOUVA descargado: {target} ({len(data)} bytes)")
PY
fi

exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8080}"
