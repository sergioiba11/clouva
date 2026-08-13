from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import trimesh

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from garment_mold import GarmentMoldError, VERSION, generate_tshirt_mold


def anchor(name: str, x: float, y: float, z: float) -> dict:
    return {
        "name": name,
        "canonical_position": [x, y, z],
        "source_position": [x, z, -y],
        "state": "surface_anchor_ready",
    }


def sample_result() -> dict:
    return {
        "run_id": "smoke-v090",
        "readiness": {"garment_mold_input_ready": True},
        "canonical_space": {
            "source_to_canonical_matrix": [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]],
            "canonical_to_source_matrix": [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]],
        },
        "body_measurements": {
            "scale": {"geometry_to_meters": 1.0, "status": "calibrated_from_height_input"},
            "sections": {
                "neck": {"status": "valid", "z": 1.37, "width_cm": 12.2, "depth_cm": 14.2, "circumference_cm": 44.0, "centroid": [0, 0.03, 1.37]},
                "chest": {"status": "valid", "z": 1.14, "width_cm": 28.8, "depth_cm": 21.9, "circumference_cm": 82.8, "centroid": [0, 0.01, 1.14]},
                "waist": {"status": "valid", "z": 1.03, "width_cm": 26.2, "depth_cm": 21.3, "circumference_cm": 77.4, "centroid": [0, 0.00, 1.03]},
                "hip": {"status": "valid", "z": 0.80, "width_cm": 32.7, "depth_cm": 19.5, "circumference_cm": 91.1, "centroid": [0, 0.04, 0.80]},
                "left_bicep": {"circumference_cm": 30.2},
                "right_bicep": {"circumference_cm": 30.2},
            },
        },
        "garment_anchors": [
            anchor("shoulder_left", -0.15, 0.01, 1.30),
            anchor("shoulder_right", 0.15, 0.01, 1.30),
            anchor("elbow_left", -0.29, 0.03, 1.07),
            anchor("elbow_right", 0.29, 0.03, 1.07),
        ],
    }


def main() -> None:
    result = sample_result()
    with tempfile.TemporaryDirectory(prefix="clouva-v090-") as directory:
        root = Path(directory)
        payload = generate_tshirt_mold(result, root, source_glb=None, fit="oversized")
        assert payload["version"] == VERSION
        assert payload["status"] == "preview_ready"
        assert payload["readiness"]["production_pattern_ready"] is False
        glb = root / payload["assets"]["glb"]
        fit_json = root / payload["assets"]["fit_json"]
        collision_json = root / payload["assets"]["collision_json"]
        assert glb.is_file() and glb.stat().st_size > 1000
        assert fit_json.is_file() and collision_json.is_file()
        scene = trimesh.load(glb, force="scene", process=False)
        vertices = sum(len(item.vertices) for item in scene.geometry.values())
        faces = sum(len(item.faces) for item in scene.geometry.values())
        assert vertices >= 400
        assert faces >= 600
        saved = json.loads(fit_json.read_text(encoding="utf-8"))
        assert saved["garment_type"] == "tshirt"
        assert saved["mesh"]["armholes_boolean_welded"] is False

    bad = sample_result()
    bad["readiness"]["garment_mold_input_ready"] = False
    try:
        generate_tshirt_mold(bad, Path(tempfile.mkdtemp()), fit="regular")
    except GarmentMoldError as exc:
        assert str(exc) == "GARMENT_MOLD_INPUT_NOT_READY"
    else:
        raise AssertionError("Expected GARMENT_MOLD_INPUT_NOT_READY")
    print("V090_SMOKE_OK")


if __name__ == "__main__":
    main()
