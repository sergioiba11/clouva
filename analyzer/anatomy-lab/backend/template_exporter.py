from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def export_meshed_payload(destination: Path, payload: dict[str, Any]) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return destination
