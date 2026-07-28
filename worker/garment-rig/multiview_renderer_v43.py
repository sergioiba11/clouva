"""V4.2.1 compatibility wrapper for selective renderer metrics."""
from __future__ import annotations

import json
from pathlib import Path

from analyzer_v42_incremental import MODULE_CAMERAS
from multiview_renderer_v42 import cleanup_render_proxies
from multiview_renderer_v42 import render_multiview_v42 as _render_multiview_v42


def render_multiview_v42(*args, **kwargs):
    manifest = _render_multiview_v42(*args, **kwargs)
    modules = list(dict.fromkeys(str(value) for value in kwargs.get("modules") or []))
    requested = {str(value) for value in kwargs.get("cameras") or [] if value}
    expected = len(requested) if requested else sum(len(MODULE_CAMERAS.get(module, ())) for module in modules)
    rendered = int(manifest.get("camerasRendered") or len(manifest.get("views") or []))
    manifest["camerasRendered"] = rendered
    manifest["camerasSkipped"] = max(0, expected - rendered)
    manifest["counterContractVersion"] = "clouva-camera-counter-v4.2.1"
    output_dir = Path(args[0] if args else kwargs["output_dir"])
    (output_dir / "camera_manifest_v42.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )
    return manifest


__all__ = ["render_multiview_v42", "cleanup_render_proxies"]
