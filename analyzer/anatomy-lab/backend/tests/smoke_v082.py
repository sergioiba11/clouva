from __future__ import annotations

from types import SimpleNamespace
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import trimesh

from measurement_quality import _oblique_limb_component


def oriented_cylinder(start, end, radius, sections=96):
    start = np.asarray(start, dtype=float)
    end = np.asarray(end, dtype=float)
    axis = end - start
    length = float(np.linalg.norm(axis))
    mesh = trimesh.creation.cylinder(radius=radius, height=length, sections=sections)
    # trimesh cylinder is centered on local Z. Rotate Z onto the requested axis.
    transform = trimesh.geometry.align_vectors([0.0, 0.0, 1.0], axis / length)
    mesh.apply_transform(transform)
    mesh.apply_translation((start + end) * 0.5)
    return mesh

# A large torso and a diagonal upper arm. The oblique limb plane must choose
# the arm loop, not the torso-sized loop.
torso = trimesh.creation.cylinder(radius=0.20, height=0.85, sections=128)
torso.apply_translation([0.0, 0.0, 1.00])
start = np.array([0.18, 0.0, 1.28])
end = np.array([0.48, 0.01, 0.92])
arm = oriented_cylinder(start, end, radius=0.052, sections=96)
mesh = trimesh.util.concatenate([torso, arm])
scene = SimpleNamespace(
    vertices=np.asarray(mesh.vertices, dtype=float),
    faces=np.asarray(mesh.faces, dtype=int),
)
scene.bounds_min = scene.vertices.min(axis=0)
scene.bounds_max = scene.vertices.max(axis=0)
scene.bounds_min[2] = 0.0
scene.bounds_max[2] = 1.8

component, diagnostic = _oblique_limb_component(
    scene, start, end, 0.64, max_perimeter_ratio=0.25, max_dimension_ratio=0.105
)
assert component is not None, diagnostic
expected = 2.0 * np.pi * 0.052
assert abs(component.perimeter - expected) < 0.025, (component.perimeter, expected, diagnostic)
assert max(component.width, component.depth) < 0.13
assert diagnostic["status"] == "isolated"
print("V0.8.2_OBLIQUE_LIMB_SMOKE_OK", component.perimeter, diagnostic)
