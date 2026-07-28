"""Fast focus-mask adapter for the retained Avatar Analyzer V4.1 renderer.

The retained renderer already generates an exact anatomical silhouette for the
allowed focus regions. Reuse that pass for coverage instead of launching a
second Workbench render on every auto-fit attempt.
"""
from __future__ import annotations

from pathlib import Path

import hand_framing_v41 as _geometry_patch


def _render_view(*args, **kwargs):
    view = _geometry_patch._ORIGINAL_RENDER_VIEW(*args, **kwargs)
    region = args[3] if len(args) > 3 else kwargs.get("region")
    if region != "hand":
        return view

    output_dir = Path(args[1])
    name = args[2]
    # `silhouettePath` is replaced by the exact technical silhouette whenever
    # AnatomyBVH is available. `allowed_regions` is the verified focus-region
    # list, so this image is the canonical focus mask used by auto-fit.
    focus_mask = _geometry_patch._mask_diagnostics(view.get("silhouettePath"))
    # The pre-technical Workbench mask remains on disk and includes the visible
    # hand + distal forearm context. It is used only for clipping diagnostics.
    context_mask = _geometry_patch._mask_diagnostics(output_dir / f"{name}_silhouette.png")

    technical = dict(view.get("technicalPasses") or {})
    technical["coverage"] = float(focus_mask.get("coverage") or 0.0)
    view["technicalPasses"] = technical
    view["_focusMaskV41"] = focus_mask
    view["_contextMaskV41"] = context_mask
    view["focusMaskSource"] = "existing_exact_technical_silhouette"
    view["duplicateFocusRenderSkipped"] = True
    return view


def install_hand_framing_patch(base_module):
    # Install the same geometry/context patch while replacing only its render
    # wrapper. The base module remains idempotent and retains all retry logic.
    _geometry_patch._render_view = _render_view
    return _geometry_patch.install_hand_framing_patch(base_module)


__all__ = ["install_hand_framing_patch"]
