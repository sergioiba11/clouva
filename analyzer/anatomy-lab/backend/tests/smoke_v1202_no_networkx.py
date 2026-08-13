from __future__ import annotations

import builtins
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import trimesh

from garment_analyzer import _connected_component_count, analyze_glb_asset


def main() -> None:
    mesh_a = trimesh.creation.box(extents=(0.3, 0.12, 0.45))
    mesh_b = trimesh.creation.box(extents=(0.08, 0.08, 0.08))
    mesh_b.apply_translation((0.5, 0.0, 0.0))
    combined = trimesh.util.concatenate([mesh_a, mesh_b])
    assert _connected_component_count(combined) == 2

    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        source = root / "r1.glb"
        combined.export(source)

        original_import = builtins.__import__

        def guarded_import(name, *args, **kwargs):
            if name == "networkx" or name.startswith("networkx."):
                raise ModuleNotFoundError("networkx intentionally unavailable in smoke test")
            return original_import(name, *args, **kwargs)

        builtins.__import__ = guarded_import
        try:
            artifacts = analyze_glb_asset(
                template_info={
                    "asset_key": "creator_reference_assets:r1",
                    "id": "r1",
                    "code": "r1",
                    "name": "r1",
                    "category": "remera",
                    "normalized_category": "tshirt",
                },
                template_glb=source,
                output_dir=root / "out",
            )
        finally:
            builtins.__import__ = original_import

        assert artifacts.analysis["version"] == "clouva-universal-garment-analyzer-v1.2.0.2"
        assert artifacts.analysis["geometry"]["connected_components"] == 2
        assert artifacts.preview_glb_path.is_file()
        assert artifacts.analysis_json_path.is_file()

    print("V1202_NO_NETWORKX_OK")


if __name__ == "__main__":
    main()
