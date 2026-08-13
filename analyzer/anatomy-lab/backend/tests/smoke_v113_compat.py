from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from template_fit_engine import create_aligned_preview, fit_template_to_run

assert callable(create_aligned_preview)
assert callable(fit_template_to_run)
print("V1131_IMPORT_COMPAT_OK")
