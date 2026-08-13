from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from garment_analyzer import FIT_MULTIPLIERS, GarmentAnalyzerError, analyze_glb_asset, fit_analyzed_glb_to_avatar

assert set(FIT_MULTIPLIERS) == {"base", "regular", "oversized"}
assert callable(analyze_glb_asset)
assert callable(fit_analyzed_glb_to_avatar)
assert issubclass(GarmentAnalyzerError, RuntimeError)
print("V120_UNIVERSAL_ANALYZER_IMPORT_OK")
