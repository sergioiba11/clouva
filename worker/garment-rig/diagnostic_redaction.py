"""Small, Blender-independent helpers for keeping runtime secrets out of reports."""
from __future__ import annotations

import re
from collections.abc import Iterable

_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}")


def redact_diagnostic_text(value: object, secrets: Iterable[object] = ()) -> str:
    text = str(value or "")
    for raw_secret in secrets:
        secret = str(raw_secret or "").strip()
        if secret:
            text = text.replace(secret, "[REDACTED]")
    return _BEARER_PATTERN.sub("Bearer [REDACTED]", text)
