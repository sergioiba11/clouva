from __future__ import annotations

import json
import tempfile
from pathlib import Path

import numpy as np
import trimesh

from template_fit_engine import create_aligned_preview, fit_template_to_run
from template_library import _standardize_clothing_item, _standardize_reference_asset


def _anchor(name: str, x: float, y: float, z: float) -> dict:
    return {
        "name": name,
        "source_position": [x, y, z],
        "canonical_position": [x, y, z],
    }


def _run_result() -> dict:
    return {
        "run_id": "smoke-v111",
        "body_measurements": {
            "scale": {"height_cm": 180, "geometry_to_meters": 1.0},
            "values": {
                "shoulder_width": {"status": "valid", "value_cm": 22.0},
                "left_arm_length": {"status": "valid", "value_cm": 57.0},
                "right_arm_length": {"status": "valid", "value_cm": 57.0},
            },
            "levels": {"chest_z": 1.20, "waist_z": 1.02, "hip_z": 0.90},
            "sections": {
                "neck": {"width_cm": 10.0, "depth_cm": 8.0, "z": 1.43},
                "chest": {"width_cm": 24.0, "depth_cm": 16.0, "z": 1.20},
                "waist": {"width_cm": 22.0, "depth_cm": 15.0, "z": 1.02},
                "hip": {"width_cm": 24.0, "depth_cm": 16.0, "z": 0.90},
                "left_bicep": {"width_cm": 9.5},
            },
        },
        "garment_anchors": [
            _anchor("shoulder_left", -0.11, 0.015, 1.36),
            _anchor("shoulder_right", 0.11, 0.015, 1.36),
            _anchor("neck_base_front", 0.0, -0.045, 1.39),
            _anchor("neck_base_back", 0.0, 0.055, 1.40),
            _anchor("chest_center", 0.0, -0.075, 1.20),
            _anchor("back_center", 0.0, 0.065, 1.20),
        ],
        "landmarks": [],
        "internal_joints": [],
    }


def main() -> None:
    r1 = _standardize_reference_asset({
        "id": "f05b5b2c-e0b8-43fa-8083-b328c6927744",
        "name": "r1",
        "category": "remera",
        "file_name": "r1.glb",
        "storage_path": "user/r1/r1.glb",
        "status": "reference",
    })
    assert r1 and r1["official_template"] is True
    assert r1["fit_supported"] is True

    h1 = _standardize_reference_asset({
        "id": "895e0791-aa58-420f-b669-c3c293d5591d",
        "name": "h1",
        "category": "hoodie",
        "file_name": "h1.glb",
        "storage_path": "user/h1/h1.glb",
        "status": "reference",
    })
    assert h1 and h1["normalized_category"] == "hoodie"

    clothing = _standardize_clothing_item({
        "id": "2e86bdef-3c27-4083-976b-0dba095b41ce",
        "name": "clovinni",
        "category": "hoodie",
        "model_url": "https://storage.googleapis.com/example/clovinni.glb",
        "status": "ready",
        "fit_status": "fitted",
        "rigged": True,
        "wearable": True,
    })
    assert clothing and clothing["fit_supported"] is True

    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        template = root / "r1.glb"
        avatar = root / "avatar.glb"

        # Deliberately place the template three meters below the avatar. The
        # preview must relocate it to the shoulder/torso area automatically.
        garment = trimesh.creation.box(extents=(0.65, 0.20, 0.72))
        garment.apply_translation([1.7, -0.8, -3.2])
        trimesh.Scene(garment).export(template)
        body = trimesh.creation.box(extents=(0.24, 0.12, 1.70))
        body.apply_translation([0.0, 0.0, 0.85])
        trimesh.Scene(body).export(avatar)

        preview = create_aligned_preview(
            _run_result(), r1, template, root / "preview", fit_mode="oversized"
        )
        assert preview.glb_path.is_file()
        assert preview.alignment_json_path.is_file()
        assert preview.payload["readiness"]["auto_alignment_ready"] is True
        shoulder_after = np.asarray(preview.payload["alignment"]["shoulder_reference_after"])
        shoulder_target = np.asarray(preview.payload["alignment"]["target_shoulder_source"])
        assert np.linalg.norm(shoulder_after - shoulder_target) < 1e-6

        aligned_scene = trimesh.load(preview.glb_path, force="scene", process=False)
        aligned_bounds = aligned_scene.bounds
        assert aligned_bounds[0][2] > 0.55, aligned_bounds
        assert aligned_bounds[1][2] < 1.75, aligned_bounds

        artifacts = fit_template_to_run(
            _run_result(),
            r1,
            template,
            avatar,
            root / "out",
            fit_mode="oversized",
        )
        assert artifacts.glb_path.is_file()
        assert artifacts.fit_json_path.is_file()
        payload = json.loads(artifacts.fit_json_path.read_text(encoding="utf-8"))
        assert payload["version"] == "clouva-template-fit-engine-v1.1.1"
        assert payload["template"]["asset_key"] == r1["asset_key"]
        assert payload["readiness"]["auto_alignment_ready"] is True
        assert payload["alignment"]["version"] == "clouva-template-auto-align-v1.1.1"

    print("V111_SMOKE_OK")


if __name__ == "__main__":
    main()
