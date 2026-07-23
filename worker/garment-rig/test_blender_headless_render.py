"""Fail the image build if Blender Workbench cannot render without a GPU/display."""
from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector


output_path = Path("/tmp/clouva-headless-workbench-smoke.png")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()

camera_data = bpy.data.cameras.new("CLOUVA_HEADLESS_SMOKE_CAMERA")
camera = bpy.data.objects.new("CLOUVA_HEADLESS_SMOKE_CAMERA", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (3.0, -3.0, 2.0)
camera.rotation_euler = (Vector((0.0, 0.0, 0.0)) - camera.location).to_track_quat("-Z", "Y").to_euler()

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = 64
scene.render.resolution_y = 64
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(output_path)

bpy.ops.render.render(write_still=True)

assert output_path.is_file(), "Workbench did not create the smoke-test PNG"
assert output_path.stat().st_size > 100, "Workbench created an empty smoke-test PNG"
print(f"[clouva] Headless Workbench render OK ({output_path.stat().st_size} bytes)")
