from __future__ import annotations

import tempfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from garment_analyzer import analyze_glb_asset
import networkx
import trimesh


def main() -> None:
    vendor_root = (ROOT / "_vendor").resolve()
    networkx_file = Path(networkx.__file__).resolve()
    if vendor_root not in networkx_file.parents:
        raise RuntimeError(f"NetworkX no salió del vendor local: {networkx_file}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        mesh = trimesh.creation.box(extents=(0.45, 0.12, 0.55))
        glb = tmp_path / "sample.glb"
        mesh.export(glb)
        artifacts = analyze_glb_asset(
            glb,
            {"code": "r1", "name": "r1", "category": "remera", "normalized_category": "tshirt"},
            tmp_path / "out",
        )
        assert artifacts.analysis_json_path.is_file()
        assert artifacts.preview_glb_path.is_file()
        assert artifacts.analysis["version"] == "clouva-universal-garment-analyzer-v1.2.0.3"
    print(f"V1203_VENDOR_NETWORKX_OK:{networkx_file}")


if __name__ == "__main__":
    main()
