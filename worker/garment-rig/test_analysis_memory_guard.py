"""Blender smoke test for bounded Avatar Analyzer topology and textures."""
from __future__ import annotations

import os

os.environ["CLOUVA_AVATAR_ANALYZER_MAX_POLYGONS"] = "2000"

import bpy

from analysis_memory_guard import prepare_analysis_meshes


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5)
avatar = bpy.context.object
avatar.name = "CLOUVA_MEMORY_GUARD_TEST_AVATAR"
avatar.shape_key_add(name="Basis")
avatar.shape_key_add(name="Expression")
bpy.data.images.new("CLOUVA_MEMORY_GUARD_TEST_TEXTURE", width=1024, height=1024)

before = len(avatar.data.polygons)
report = prepare_analysis_meshes([avatar])
after = len(avatar.data.polygons)

assert before > 10_000, before
assert report["sourceGlbModified"] is False
assert report["analysisCopyOnly"] is True
assert report["reduced"] is True
assert report["imagesRemoved"] >= 1
assert 100 <= after <= 2400, after
assert avatar.data.shape_keys is None
print(f"[clouva] Avatar analysis memory guard OK ({before}->{after} polygons)")
