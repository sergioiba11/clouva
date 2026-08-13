from __future__ import annotations

import ast
from pathlib import Path

import numpy as np
import trimesh

from canonical_space import build_canonical_transform
from glb_loader import load_glb

def test_load_simple_glb(tmp_path: Path):
    path = tmp_path / "avatar.glb"
    scene = trimesh.Scene(trimesh.creation.box(extents=(1.0, 0.5, 2.0)))
    scene.export(path)
    loaded = load_glb(path)
    assert loaded.metadata["vertex_count"] > 0
    assert loaded.metadata["triangle_count"] > 0
    transform = build_canonical_transform(loaded)
    assert transform.source_to_canonical.shape == (4, 4)
    assert np.isfinite(transform.source_to_canonical).all()

def test_no_blender_imports():
    root = Path(__file__).resolve().parents[1]
    forbidden = ("bpy", "mathutils")
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert all(alias.name.split(".")[0] not in forbidden for alias in node.names)
            if isinstance(node, ast.ImportFrom) and node.module:
                assert node.module.split(".")[0] not in forbidden
