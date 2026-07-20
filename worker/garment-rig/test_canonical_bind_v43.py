import importlib.util
import json
import math
import os

import bpy
from mathutils import Matrix


SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment.py")
spec = importlib.util.spec_from_file_location("clouva_rig_v43_test", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
legacy = module.legacy

legacy.clear_scene()

bpy.ops.object.armature_add(enter_editmode=True, location=(0.0, 0.0, 0.0))
armature = bpy.context.object
armature.name = "TestArmature"
edit_bone = armature.data.edit_bones[0]
edit_bone.name = "Hips"
edit_bone.head = (0.0, 0.0, 0.0)
edit_bone.tail = (0.0, 0.0, 1.0)
bpy.ops.object.mode_set(mode="OBJECT")
armature.matrix_world = Matrix.Scale(2.0, 4)

bpy.ops.mesh.primitive_cube_add(size=2.0)
mesh = bpy.context.object
mesh.name = "TestBody"
mesh.matrix_world = Matrix.Scale(2.0, 4)
modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
modifier.object = armature
mesh.parent = armature
mesh.matrix_parent_inverse = armature.matrix_world.inverted_safe()
mesh.matrix_world = Matrix.Scale(2.0, 4)

bpy.context.view_layer.update()
metadata = {"bounds": {"imported": {"sizeCm": {"z": 200.0}}}}
report = module.normalize_official_avatar_canonical_v43(
    [armature, mesh],
    armature,
    [mesh],
    metadata,
)

assert report["version"] == 43
assert report["armature"] == "TestArmature"
assert report["boneCount"] == 1
assert math.isclose(report["sourceHeight"], 4.0, rel_tol=0.0, abs_tol=1e-6)
assert math.isclose(report["detectedScale"], 0.5, rel_tol=0.0, abs_tol=1e-8)
assert math.isclose(report["canonicalHeight"], 2.0, rel_tol=0.0, abs_tol=1e-6)
assert report["restPoseDifferenceAfter"] <= 1e-7
assert report["bindRestDifferenceAfter"] <= 1e-6
assert report["maximumGeometryDrift"] <= 1e-6
assert armature.data.pose_position == "REST"
assert all(abs(component - 1.0) <= 1e-6 for component in armature.scale)
assert all(abs(component - 1.0) <= 1e-6 for component in mesh.scale)
assert module._matrix_delta(armature.matrix_world) <= 1e-6
assert module._matrix_delta(mesh.matrix_world) <= 1e-6
assert mesh.find_armature() == armature
assert int(armature["clouvaCanonicalBindVersion"]) == 43
assert int(armature["clouvaPrebindSpaceVersion"]) == module.PREBIND_SPACE_VERSION

sidecar = os.path.join(os.getcwd(), "canonical-bind-diagnostics.json")
assert os.path.exists(sidecar)
with open(sidecar, encoding="utf-8") as handle:
    persisted = json.load(handle)
assert persisted["version"] == 43
os.remove(sidecar)

print("[clouva] V43 canonical rest/bind normalization OK")
