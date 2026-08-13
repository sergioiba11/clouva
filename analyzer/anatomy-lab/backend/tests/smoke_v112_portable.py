from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import template_fit_engine as engine


def main() -> None:
    required = (
        "create_aligned_preview",
        "fit_template_to_run",
    )
    missing = [name for name in required if not hasattr(engine, name)]
    if missing:
        raise RuntimeError(f"V112_FUNCTIONS_MISSING:{','.join(missing)}")

    source = Path(engine.__file__).read_text(encoding="utf-8")
    markers = (
        "clouva-template-semantic-auto-align-v1.1.2",
        "body-semantic-frame-collar-loop-24-rotation-search",
        "clouva-template-fit-engine-v1.1.2",
    )
    absent = [marker for marker in markers if marker not in source]
    if absent:
        raise RuntimeError(f"V112_MARKERS_MISSING:{','.join(absent)}")

    print("V112_PORTABLE_SMOKE_OK")


if __name__ == "__main__":
    main()
