"""CLOUVA Avatar Analyzer V4.2.2 profile-aware execution wrapper."""
from __future__ import annotations

import avatar_analyzer_v43 as topology_safe
from analyzer_v43_incremental import build_incremental_plan
from hand_analyzer_v43 import analyze_hand_module_v42, set_hand_detail

base = topology_safe.base
_PREVIOUS_EXECUTE_PLAN = base._execute_plan


def _execute_profile_plan(context: dict, plan: dict, output_dir):
    options = plan.get("moduleOptions") or {}
    hand_options = [
        options.get(module) or {}
        for module in ("left_hand", "right_hand")
        if module in (plan.get("modules") or [])
    ]
    include_fingers = any(bool(item.get("includeFingers")) for item in hand_options)
    set_hand_detail(include_fingers)
    try:
        return _PREVIOUS_EXECUTE_PLAN(context, plan, output_dir)
    finally:
        set_hand_detail(True)


base.build_incremental_plan = build_incremental_plan
base.analyze_hand_module_v42 = analyze_hand_module_v42
base._execute_plan = _execute_profile_plan


if __name__ == "__main__":
    base.main()
