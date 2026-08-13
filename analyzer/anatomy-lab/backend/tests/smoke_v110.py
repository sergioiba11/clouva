from __future__ import annotations

import json
import tempfile
from pathlib import Path

import trimesh

from template_fit_engine import fit_template_to_run
from template_library import _standardize_clothing_item, _standardize_reference_asset


def _run_result() -> dict:
    return {
        "run_id": "smoke-v110",
        "body_measurements": {
            "scale": {"height_cm": 180},
            "values": {
                "shoulder_width": {"status": "valid", "value_cm": 22.0},
                "left_arm_length": {"status": "valid", "value_cm": 57.0},
                "right_arm_length": {"status": "valid", "value_cm": 57.0},
            },
            "sections": {
                "neck": {"width_cm": 10.0, "depth_cm": 8.0, "z": 1.50},
                "chest": {"width_cm": 24.0, "depth_cm": 16.0, "z": 1.28},
                "waist": {"width_cm": 22.0, "depth_cm": 15.0, "z": 1.05},
                "hip": {"width_cm": 24.0, "depth_cm": 16.0, "z": 0.92},
                "left_bicep": {"width_cm": 9.5},
            },
        },
        "garment_anchors": [],
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
    assert r1["asset_key"].startswith("creator_reference_assets:")

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
    assert clothing["source_table"] == "clothing_items"

    pants = _standardize_clothing_item({
        "id": "pants-id",
        "name": "cargo",
        "category": "pants",
        "model_url": "https://storage.googleapis.com/example/cargo.glb",
    })
    assert pants and pants["fit_supported"] is False
    assert pants["compatibility"] == "engine_pending"

    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        template = root / "r1.glb"
        avatar = root / "avatar.glb"
        trimesh.creation.box(extents=(0.30, 0.16, 0.50)).export(template)
        trimesh.creation.box(extents=(0.24, 0.12, 1.70)).export(avatar)
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
        assert payload["version"] == "clouva-template-fit-engine-v1.1.0"
        assert payload["template"]["asset_key"] == r1["asset_key"]

    print("V110_SMOKE_OK")


if __name__ == "__main__":
    main()
