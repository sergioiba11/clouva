import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

# Blender ejecuta los scripts con --python desde un directorio temporal y no siempre
# agrega /app (donde viven los scripts del Worker) a sys.path. Aseguramos que el
# exportador base pueda importarse sin depender del cwd del job.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import export_unreal as base


def bake_mesh_data_scale(mesh):
    scale = tuple(float(value) for value in mesh.scale)
    if all(math.isclose(value, 1.0, abs_tol=1e-6) for value in scale):
        return

    # Blender's transform_apply can keep a compensating local scale on skinned child
    # meshes. Transform the mesh datablock directly, then clear only the object's scale.
    # Vertex groups, skin weights and Armature modifiers stay attached to the same mesh.
    mesh.data.transform(Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0)))
    mesh.scale = (1.0, 1.0, 1.0)
    mesh.data.update()


def apply_uniform_scale_clean(objects, meshes, armatures, factor):
    roots = base.root_objects(objects)
    for obj in roots:
        obj.scale = tuple(float(value) * factor for value in obj.scale)
    bpy.context.view_layer.update()

    base.apply_scale_to_selection(
        roots,
        next((obj for obj in roots if obj.type == "ARMATURE"), roots[0]),
    )

    for mesh in meshes:
        bake_mesh_data_scale(mesh)

    for armature in armatures:
        if any(not math.isclose(float(value), 1.0, abs_tol=1e-6) for value in armature.scale):
            base.apply_scale_to_selection([armature], armature)

    bpy.context.view_layer.update()


base.apply_uniform_scale = apply_uniform_scale_clean

if __name__ == "__main__":
    base.main()
