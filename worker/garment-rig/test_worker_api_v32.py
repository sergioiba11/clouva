"""Import-time Worker contract checks for Avatar Analyzer V3.2 integration.

Legacy AutoRig, weight, Unreal and garment contracts are validated by the
existing Blender tests that run after this file in the Docker build. This test
only verifies the new public route wiring and avoids duplicating inherited
version assertions from app_v15/app_v16.
"""
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
        "/avatar/analyze-preview",
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
    check("complete-rig endpoint", avatar_route.endpoint.__name__, "complete_avatar_rig_analyzer_gated")

    check("COMPLETE_AVATAR_RIG_SCRIPT", app.COMPLETE_AVATAR_RIG_SCRIPT.name, "autorig_avatar_v18.py")
    check("AVATAR_ANALYZER_VERSION", app.AVATAR_ANALYZER_VERSION, "clouva-avatar-analyzer-v3.2")
    check("AVATAR_ANALYZER_SCRIPT", app.AVATAR_ANALYZER_SCRIPT.name, "avatar_analyzer.py")
    check("single-flight lock available", hasattr(app, "ANALYZER_RIG_LOCK"), True)
    check("AutoRig wrapper available", app.ANALYZER_AUTORIG_SCRIPT.is_file(), True)
    check("Analyzer script available", app.AVATAR_ANALYZER_SCRIPT.is_file(), True)

    print("[clouva] Worker API + Analyzer V3.2 gate wiring OK", flush=True)


if __name__ == "__main__":
    main()
