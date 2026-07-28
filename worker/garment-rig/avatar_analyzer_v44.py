"""CLOUVA Avatar Analyzer V4.2.2 profile-aware execution wrapper."""
from __future__ import annotations

import json
from pathlib import Path

import avatar_analyzer_v43 as topology_safe
from analyzer_v43_incremental import build_incremental_plan
from hand_analyzer_v43 import analyze_hand_module_v42, set_hand_detail

base = topology_safe.base
_PREVIOUS_EXECUTE_PLAN = base._execute_plan
_ORIGINAL_RENDERER = base.render_multiview_v42


def _empty_visual_manifest(output_dir: Path, modules: list[str]):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": "clouva-adaptive-camera-rig-v4.2.2",
        "renderer": "SKIPPED_FOR_GEOMETRY_ONLY_HAND_PROFILE",
        "projectionMode": "not_required",
        "modules": modules,
        "requestedCameras": [],
        "views": [],
        "camerasRendered": 0,
        "camerasSkipped": 0,
        "fullTechnicalPassesGenerated": 0,
        "sparseProjectionsEnabled": False,
        "cleanupProxyNames": [],
    }
    (output_dir / "camera_manifest_v42.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )
    return manifest


def _execute_profile_plan(context: dict, plan: dict, output_dir):
    options = plan.get("moduleOptions") or {}
    hand_modules = [
        module for module in ("left_hand", "right_hand")
        if module in (plan.get("modules") or [])
    ]
    hand_options = [options.get(module) or {} for module in hand_modules]
    include_fingers = any(bool(item.get("includeFingers")) for item in hand_options)
    geometry_only_hands = bool(hand_modules and not include_fingers)
    has_visual_non_hand_module = "face" in (plan.get("modules") or [])
    set_hand_detail(include_fingers)
    if geometry_only_hands and not has_visual_non_hand_module:
        base.render_multiview_v42 = lambda render_dir, *_args, **_kwargs: _empty_visual_manifest(
            render_dir,
            hand_modules,
        )
    try:
        return _PREVIOUS_EXECUTE_PLAN(context, plan, output_dir)
    finally:
        base.render_multiview_v42 = _ORIGINAL_RENDERER
        set_hand_detail(True)


base.build_incremental_plan = build_incremental_plan
base.analyze_hand_module_v42 = analyze_hand_module_v42
base._execute_plan = _execute_profile_plan


if __name__ == "__main__":
    base.main()
