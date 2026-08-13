from __future__ import annotations

import tempfile
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import trimesh

from template_fit_engine import create_aligned_preview, fit_template_to_run


def ring(width: float, depth: float, height: float, count: int = 24) -> np.ndarray:
    points = []
    for index in range(count):
        angle = 2.0 * np.pi * index / count
        points.append([np.cos(angle) * width * 0.5, np.sin(angle) * depth * 0.5, height])
    return np.asarray(points, dtype=np.float64)


def open_garment_mesh() -> trimesh.Trimesh:
    # A simple open garment shell: small collar ring, shoulder/chest ring, waist,
    # and hem. It deliberately has no caps, so collar and hem remain detectable.
    rings = [
        ring(0.14, 0.10, 0.50),
        ring(0.32, 0.17, 0.40),
        ring(0.28, 0.16, 0.20),
        ring(0.30, 0.17, 0.00),
    ]
    vertices = np.vstack(rings)
    count = len(rings[0])
    faces = []
    for layer in range(len(rings) - 1):
        a0 = layer * count
        b0 = (layer + 1) * count
        for index in range(count):
            nxt = (index + 1) % count
            faces.append([a0 + index, b0 + index, b0 + nxt])
            faces.append([a0 + index, b0 + nxt, a0 + nxt])
    return trimesh.Trimesh(vertices=vertices, faces=np.asarray(faces, dtype=np.int64), process=False)


def point(name, position):
    return {"name": name, "source_position": list(position), "canonical_position": list(position)}


def run_result():
    # CLOUVA avatar source space: Y is up, Z is forward.
    anchors = [
        point("shoulder_left", (-0.08, 1.30, 0.0)),
        point("shoulder_right", (0.08, 1.30, 0.0)),
        point("hip_left", (-0.07, 0.88, 0.0)),
        point("hip_right", (0.07, 0.88, 0.0)),
        point("neck_base_front", (0.0, 1.34, 0.045)),
        point("neck_base_back", (0.0, 1.34, -0.035)),
        point("chest_center", (0.0, 1.18, 0.075)),
        point("back_center", (0.0, 1.18, -0.065)),
        point("waist_front", (0.0, 1.00, 0.06)),
        point("waist_back", (0.0, 1.00, -0.05)),
    ]
    return {
        "run_id": "smoke-v112",
        "garment_anchors": anchors,
        "landmarks": [],
        "body_measurements": {
            "scale": {"height_cm": 180.0, "geometry_to_meters": 1.0},
            "values": {
                "shoulder_width": {"status": "valid", "value_cm": 16.0},
                "left_arm_length": {"status": "valid", "value_cm": 55.0},
                "right_arm_length": {"status": "valid", "value_cm": 55.0},
            },
            "sections": {
                "neck": {"status": "valid", "width_cm": 10.0, "depth_cm": 8.0, "z": 1.34},
                "chest": {"status": "valid", "width_cm": 24.0, "depth_cm": 15.0, "z": 1.18},
                "waist": {"status": "valid", "width_cm": 22.0, "depth_cm": 14.0, "z": 1.00},
                "hip": {"status": "valid", "width_cm": 24.0, "depth_cm": 15.0, "z": 0.88},
                "left_bicep": {"status": "valid", "width_cm": 8.0},
            },
        },
        "internal_joints": [],
    }


def main():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        garment = open_garment_mesh()
        # Deliberately swap axes and place the garment far behind/below.
        source_rotation = np.array([[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        garment.vertices = np.asarray(garment.vertices) @ source_rotation.T + np.array([2.4, -3.0, 1.7])
        garment_path = root / "r1.glb"
        garment.export(garment_path)

        avatar = trimesh.creation.capsule(radius=0.10, height=1.0)
        avatar.apply_transform(
            np.array([
                [1, 0, 0, 0],
                [0, 0, 1, 0.75],
                [0, -1, 0, 0],
                [0, 0, 0, 1],
            ], dtype=float)
        )
        avatar_path = root / "avatar.glb"
        avatar.export(avatar_path)

        info = {"asset_key": "creator_reference_assets:r1", "id": "r1", "code": "r1", "name": "r1", "category": "remera", "normalized_category": "tshirt"}
        preview = create_aligned_preview(run_result(), info, garment_path, root / "preview", "oversized", avatar_glb=avatar_path)
        alignment = preview.payload["alignment"]
        assert alignment["method"] == "body-semantic-frame-collar-loop-24-rotation-search"
        assert alignment["validation"]["torso_depth_straddled"] is True, alignment
        assert alignment["validation"]["hangs_down_body"] is True, alignment
        assert alignment["validation"]["centered_on_torso"] is True, alignment
        assert alignment["ready"] is True, alignment
        assert preview.glb_path.is_file()
        assert preview.alignment_json_path.is_file()

        fitted = fit_template_to_run(run_result(), info, garment_path, avatar_path, root / "fitted", "oversized")
        assert fitted.glb_path.is_file()
        assert fitted.fit_json["version"] == "clouva-template-fit-engine-v1.1.2"
        assert fitted.fit_json["alignment"]["ready"] is True
    print("V112_SEMANTIC_ALIGNMENT_OK")


if __name__ == "__main__":
    main()
