from __future__ import annotations
import numpy as np
import trimesh

from body_measurements import slice_mesh_at_z, build_slice_components, choose_component

mesh = trimesh.creation.cylinder(radius=0.2, height=1.0, sections=96)
vertices = np.asarray(mesh.vertices, dtype=float)
vertices[:, 2] += 0.5
faces = np.asarray(mesh.faces, dtype=int)
segments = slice_mesh_at_z(vertices, faces, 0.5)
components = build_slice_components(segments)
component = choose_component(components, np.array([0.0, 0.0]))
assert component is not None
expected = 2 * np.pi * 0.2
assert abs(component.perimeter - expected) < 0.02, (component.perimeter, expected)
assert component.closed
assert abs(component.width - 0.4) < 0.02
assert abs(component.depth - 0.4) < 0.02
print('V0.8_SMOKE_OK')
