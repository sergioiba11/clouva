from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import trimesh

from garment_analyzer import analyze_glb_asset, fit_analyzed_glb_to_avatar


def make_tshirt() -> trimesh.Trimesh:
    torso = trimesh.creation.box(extents=(0.34, 0.14, 0.46))
    left = trimesh.creation.box(extents=(0.18, 0.13, 0.16))
    right = left.copy()
    left.apply_translation((-0.25, 0.0, 0.14))
    right.apply_translation((0.25, 0.0, 0.14))
    return trimesh.util.concatenate([torso, left, right])


def avatar_run() -> dict:
    return {
        "run_id": "smoke-v120",
        "source": {
            "bounds_min": [-0.55, 0.0, -0.19],
            "bounds_max": [0.56, 1.8, 0.19],
        },
        "canonical_space": {
            "source_to_canonical_matrix": [
                [1, 0, 0, 0],
                [0, 0, -1, 0],
                [0, 1, 0, 0],
                [0, 0, 0, 1],
            ],
            "canonical_to_source_matrix": [
                [1, 0, 0, 0],
                [0, 0, 1, 0],
                [0, -1, 0, 0],
                [0, 0, 0, 1],
            ],
        },
        "body_measurements": {
            "scale": {"geometry_to_meters": 1.0, "height_cm": 180.0},
            "values": {
                "shoulder_width": {"status": "valid", "value_cm": 22.0},
            },
            "sections": {
                "chest": {"width_cm": 24.0, "depth_cm": 16.0},
                "waist": {"width_cm": 22.0, "depth_cm": 15.0},
                "hip": {"width_cm": 25.0, "depth_cm": 17.0},
            },
        },
        "garment_anchors": [
            {"name": "neck_base_front", "source_position": [0.0, 1.36, -0.04]},
            {"name": "neck_base_back", "source_position": [0.0, 1.36, 0.04]},
            {"name": "chest_center", "source_position": [0.0, 1.18, -0.07]},
            {"name": "back_center", "source_position": [0.0, 1.18, 0.07]},
            {"name": "waist_front", "source_position": [0.0, 1.00, -0.06]},
            {"name": "waist_back", "source_position": [0.0, 1.00, 0.06]},
            {"name": "left_hip", "source_position": [-0.12, 0.84, 0.0]},
            {"name": "right_hip", "source_position": [0.12, 0.84, 0.0]},
            {"name": "left_ankle", "source_position": [-0.10, 0.08, 0.0]},
            {"name": "right_ankle", "source_position": [0.10, 0.08, 0.0]},
        ],
        "landmarks": [],
        "internal_joints": [],
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        shirt = make_tshirt()
        # Deliberately rotate and offset it to simulate an arbitrary library GLB.
        transform = np.array([
            [0, 0, 1, 2.4],
            [1, 0, 0, -3.0],
            [0, 1, 0, 1.8],
            [0, 0, 0, 1.0],
        ], dtype=float)
        shirt.apply_transform(transform)
        shirt_path = root / "any-shirt.glb"
        shirt.export(shirt_path)

        avatar = trimesh.creation.capsule(radius=0.10, height=1.55)
        avatar.apply_translation((0.0, 0.9, 0.0))
        avatar_path = root / "avatar.glb"
        avatar.export(avatar_path)

        info = {
            "asset_key": "creator_reference_assets:any",
            "id": "any",
            "name": "Remera cualquiera",
            "category": "remera",
            "normalized_category": "tshirt",
            "file_name": "any-shirt.glb",
        }
        analysis = analyze_glb_asset(shirt_path, info, root / "analysis")
        assert analysis.analysis["version"] == "clouva-universal-garment-analyzer-v1.2.0"
        assert analysis.analysis["classification"]["category"] == "top"
        assert analysis.analysis["readiness"]["universal_fit_ready"] is True
        assert "neck_center" in analysis.analysis["landmarks"]
        assert analysis.preview_glb_path.is_file()

        fitted = fit_analyzed_glb_to_avatar(
            avatar_run(), info, shirt_path, avatar_path, root / "fit", "oversized"
        )
        assert fitted.glb_path.is_file()
        assert fitted.fit_json_path.is_file()
        assert fitted.analysis_json_path.is_file()
        assert fitted.fit_json["version"] == "clouva-universal-avatar-fit-engine-v1.2.0"
        assert fitted.fit_json["fit"]["target_anchor"] == "torso"
        matrix = np.asarray(fitted.fit_json["fit"]["source_to_avatar_matrix"], dtype=float)
        assert matrix.shape == (4, 4)
        assert np.isfinite(matrix).all()
        json.loads(fitted.fit_json_path.read_text(encoding="utf-8"))
    print("V120_UNIVERSAL_GLB_ANALYZER_OK")


if __name__ == "__main__":
    main()
