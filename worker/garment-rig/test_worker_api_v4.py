"""Import-time route contract checks for side-by-side Avatar Analyzer V4."""
from __future__ import annotations

import app


def check(name, actual, expected):
    print(f"[clouva] {name}: actual={actual!r} expected={expected!r}", flush=True)
    assert actual == expected, f"{name}: expected {expected!r}, received {actual!r}"


def main():
    paths = {getattr(route, "path", "") for route in app.app.routes}
    required = {
        "/avatar/analyze", "/avatar/complete-rig", "/diagnostics/avatar-analyzer",
        "/avatar/analyze-v4", "/avatar/analyze-v4-preview",
        "/avatar/analyze-v4/result/{run_id}",
        "/avatar/analyze-v4/result/{run_id}/manual-corrections",
        "/avatar/analyze-v4/result/{run_id}/reanalyze",
        "/avatar/complete-rig-v4", "/diagnostics/avatar-analyzer-v4",
    }
    missing = sorted(required - paths)
    print(f"[clouva] V4 route count={len(paths)} missing={missing}", flush=True)
    assert not missing, f"Missing V4 Worker routes: {missing}"
    check("legacy V3.2 preserved", app.AVATAR_ANALYZER_VERSION, "clouva-avatar-analyzer-v3.2")
    check("V4 version", app.AVATAR_ANALYZER_V4_VERSION, "clouva-avatar-analyzer-v4.1")
    check("V4 analyzer script", app.AVATAR_ANALYZER_V4_SCRIPT.name, "avatar_analyzer_v4.py")
    check("V4 autorig script", app.ANALYZER_AUTORIG_V4_SCRIPT.name, "autorig_avatar_v19.py")
    check("V4 analyzer available", app.AVATAR_ANALYZER_V4_SCRIPT.is_file(), True)
    check("V4 autorig available", app.ANALYZER_AUTORIG_V4_SCRIPT.is_file(), True)
    assert app.RUN_TTL_SECONDS >= 30 * 24 * 60 * 60, "Analyzer results must survive normal user return windows"
    print("[clouva] Worker API exposes V3.2 and V4 side by side OK", flush=True)


if __name__ == "__main__":
    main()
