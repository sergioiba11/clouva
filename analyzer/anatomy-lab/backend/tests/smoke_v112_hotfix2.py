from __future__ import annotations

import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

engine = importlib.import_module("template_fit_engine")
main_source = (ROOT / "main.py").read_text(encoding="utf-8")
engine_source = Path(engine.__file__).read_text(encoding="utf-8")

assert Path(engine.__file__).resolve() == (ROOT / "template_fit_engine.py").resolve(), engine.__file__
assert engine.ALIGNMENT_VERSION == "clouva-template-semantic-auto-align-v1.1.2"
assert engine.FIT_ENGINE_VERSION == "clouva-template-fit-engine-v1.1.2"
assert engine.ENGINE_BUILD == "backend-force-hotfix2"
assert "body-semantic-frame-collar-loop-24-rotation-search" in engine_source
assert "/api/runtime/template-engine" in main_source
assert "library_previews_v112_hotfix2" in main_source
assert "library_fits_v112_hotfix2" in main_source
print("V112_HOTFIX2_BACKEND_FORCE_OK")
print(f"MODULE={Path(engine.__file__).resolve()}")
print(f"ALIGNMENT_VERSION={engine.ALIGNMENT_VERSION}")
print(f"ENGINE_BUILD={engine.ENGINE_BUILD}")
