from pathlib import Path
import numpy as np
import trimesh

from camera_rig import body_cameras
from canonical_space import build_canonical_transform
from glb_loader import load_glb
from raycast_scene import AnatomyRaycastScene


def test_software_geometry_backend_renders_triangle_ids(tmp_path: Path):
    mesh = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
    path = tmp_path / "sphere.glb"
    mesh.export(path)
    loaded = load_glb(path)
    canonical = build_canonical_transform(loaded)
    scene = AnatomyRaycastScene(loaded, canonical)
    camera = body_cameras(scene.bounds_min, scene.bounds_max, resolution=64)[0]
    buffers = scene.render_camera(camera)
    assert buffers["valid"].any()
    assert np.all(buffers["primitive_ids"][buffers["valid"]] >= 0)
    sums = buffers["barycentric"][buffers["valid"]].sum(axis=1)
    assert np.allclose(sums, 1.0, atol=1e-4)
