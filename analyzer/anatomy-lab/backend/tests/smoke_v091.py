from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from garment_mold import VERSION, generate_tshirt_mold


def section(z, width, depth):
    return {
        "status": "valid",
        "z": z,
        "width_cm": width,
        "depth_cm": depth,
        "centroid": [0.0, 0.0, z],
    }


def anchor(name, x, y, z):
    return {"name": name, "canonical_position": [x, y, z]}


payload = {
    "run_id": "smoke-v091",
    "readiness": {"garment_mold_input_ready": True},
    "canonical_space": {
        "canonical_to_source_matrix": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
        "source_to_canonical_matrix": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
    },
    "body_measurements": {
        "scale": {"geometry_to_meters": 1.0},
        "sections": {
            "neck": section(1.40, 12.5, 14.0),
            "chest": section(1.15, 29.0, 22.0),
            "waist": section(1.02, 27.0, 20.5),
            "hip": section(0.80, 33.0, 20.0),
            "left_bicep": {"circumference_cm": 30.0},
            "right_bicep": {"circumference_cm": 30.0},
        },
    },
    "garment_anchors": [
        anchor("shoulder_left", -0.15, 0.0, 1.31),
        anchor("shoulder_right", 0.15, 0.0, 1.31),
        anchor("elbow_left", -0.32, 0.0, 1.08),
        anchor("elbow_right", 0.32, 0.0, 1.08),
    ],
}

with tempfile.TemporaryDirectory() as temp:
    result = generate_tshirt_mold(payload, Path(temp), source_glb=None, fit="oversized")
    assert result["version"] == VERSION
    mesh = result["mesh"]
    assert mesh["connected_shells"] == 1, mesh
    assert mesh["armholes_welded_by_shared_topology"] is True
    assert mesh["nonmanifold_edge_count"] == 0, mesh
    assert mesh["boundary_loop_count"] == 4, mesh
    assert mesh["expected_openings_verified"] is True
    assert result["readiness"]["single_connected_shell_ready"] is True
    assert result["readiness"]["armholes_connected_ready"] is True
    assert Path(temp, result["assets"]["glb"]).is_file()
    assert Path(temp, result["assets"]["fit_json"]).is_file()
print("V091_SMOKE_OK")
