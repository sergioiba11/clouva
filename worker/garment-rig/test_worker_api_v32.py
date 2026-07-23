"""Explicit import-time Worker contract checks for Docker build diagnostics."""
from __future__ import annotations

import app


def check(name, actual, expected):
    print(f"[clouva] {name}: actual={actual!r} expected={expected!r}", flush=True)
    assert actual == expected, f"{name}: expected {expected!r}, received {actual!r}"


def main():
    paths = {getattr(route, "path", "") for route in app.app.routes}
    required_paths = {
        "/rig",
        "/avatar/complete-rig",
        "/avatar/analyze",
        "/diagnostics/avatar-analyzer",
        "/rig-with-unreal-mold",
        "/diagnostics/unreal-mold",
        "/diagnostics/avatar-complete-rig",
        "/diagnostics/health",
        "/diagnostics/latest-rig-failure",
        "/diagnostics/canonical-bind",
    }
    missing = sorted(required_paths - paths)
    print(f"[clouva] Worker route count={len(paths)} missing={missing}", flush=True)
    assert not missing, f"Missing Worker routes: {missing}"

    avatar_routes = [
        route for route in app.app.routes
        if getattr(route, "path", "") == "/avatar/complete-rig"
        and "POST" in (getattr(route, "methods", set()) or set())
    ]
    check("complete-rig POST route count", len(avatar_routes), 1)
    avatar_route = avatar_routes[0]

    check("MAX_CONCURRENT_BLENDER_JOBS", app.MAX_CONCURRENT_BLENDER_JOBS, 1)
    check("CLEAN_ATTEMPT_VERSION", app.CLEAN_ATTEMPT_VERSION, "v43-fresh-source-per-attempt")
    check("COMPLETE_AVATAR_RIG_VERSION", app.COMPLETE_AVATAR_RIG_VERSION, "v15-anatomical-landmark-autorig")
    check("COMPLETE_AVATAR_RIG_SCRIPT", app.COMPLETE_AVATAR_RIG_SCRIPT.name, "autorig_avatar_v18.py")
    check("AVATAR_ANALYZER_VERSION", app.AVATAR_ANALYZER_VERSION, "clouva-avatar-analyzer-v3.2")
    check("AVATAR_ANALYZER_SCRIPT", app.AVATAR_ANALYZER_SCRIPT.name, "avatar_analyzer.py")
    check("current COMPLETE_AVATAR_RIG_VERSION", app.current.COMPLETE_AVATAR_RIG_VERSION, "v15-anatomical-landmark-autorig")
    check("current COMPLETE_AVATAR_RIG_SCRIPT", app.current.COMPLETE_AVATAR_RIG_SCRIPT.name, "autorig_avatar_v18.py")
    check(
        "route global COMPLETE_AVATAR_RIG_SCRIPT",
        avatar_route.endpoint.__globals__["COMPLETE_AVATAR_RIG_SCRIPT"].name,
        "autorig_avatar_v18.py",
    )
    print("[clouva] Worker API + Analyzer V3.2 gated AutoRig V16 routes OK", flush=True)


if __name__ == "__main__":
    main()
