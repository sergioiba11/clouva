from __future__ import annotations

import inspect
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import garment_analyzer
import main


def main_check() -> None:
    assert main.app.version == "1.3.0.1"

    routes = {getattr(route, "path", "") for route in main.app.routes}
    required_routes = {
        "/api/runs/{run_id}/analyze-library-asset",
        "/api/runs/{run_id}/accept-garment-analysis",
        "/api/runs/{run_id}/fit-library-asset",
    }
    missing = sorted(required_routes - routes)
    assert not missing, f"Rutas faltantes: {missing}"

    required_functions = {
        "analyze_glb_asset": garment_analyzer.analyze_glb_asset,
        "accept_garment_analysis": garment_analyzer.accept_garment_analysis,
        "fit_analyzed_glb_to_avatar": garment_analyzer.fit_analyzed_glb_to_avatar,
    }
    for name, fn in required_functions.items():
        assert callable(fn), f"{name} no es callable"
        assert inspect.signature(fn), f"{name} sin firma"

    source = Path(garment_analyzer.__file__).read_text(encoding="utf-8")
    assert "clouva-garment-analysis-workspace-v1.3.0.1" in source
    assert "analysis_accepted" in source
    assert "universal_fit_ready" in source

    print("V1301_SAFE_WORKSPACE_SMOKE_OK")


if __name__ == "__main__":
    main_check()
