from __future__ import annotations

import json
import platform
import struct
import sys
import traceback

result = {
    "python": sys.version,
    "executable": sys.executable,
    "architecture_bits": struct.calcsize("P") * 8,
    "platform": platform.platform(),
    "open3d_available": False,
    "open3d_version": None,
    "raycasting_scene_available": False,
    "error": None,
}

try:
    import open3d as o3d
    result["open3d_available"] = True
    result["open3d_version"] = getattr(o3d, "__version__", "unknown")
    _ = o3d.t.geometry.RaycastingScene()
    result["raycasting_scene_available"] = True
except Exception as exc:
    result["error"] = f"{type(exc).__name__}: {exc}"
    result["traceback"] = traceback.format_exc()

print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(0 if result["raycasting_scene_available"] else 1)
