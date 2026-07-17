"""Paso 1: 'Rigear objeto'. Le da a un GLB de objeto (gorra, cadena, mochila, etc.) un
esqueleto PROPIO -- una cadena de huesos a lo largo de su eje principal -- y exporta un GLB
independiente (objeto + su propio armature), sin tocar el avatar todavia. El paso 2
(attach_object.py) es el que despues conecta ese hueso raiz al avatar.

Uso: blender --background --python rig_object.py -- input.glb output.glb category [bone_count]
"""
import sys

import bpy
from mathutils import Vector

# category -> a lo largo de que extremo del bounding box (en Z, altura tras importar el GLB)
# arranca el hueso raiz (el que despues se conecta al avatar).
CATEGORY_RIG_CONFIG = {
    "gorra": {"attach_end": "min", "bone_count": 3},
    "cadena": {"attach_end": "max", "bone_count": 3},
    "lentes": {"attach_end": "max", "bone_count": 2},
    "mochila": {"attach_end": "max", "bone_count": 3},
    "aros": {"attach_end": "max", "bone_count": 2},
    "guantes": {"attach_end": "max", "bone_count": 2},
    "pulseras": {"attach_end": "max", "bone_count": 2},
    "anillos": {"attach_end": "max", "bone_count": 2},
    "accessory": {"attach_end": "max", "bone_count": 3},
}
DEFAULT_CONFIG = {"attach_end": "max", "bone_count": 3}


def args():
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) not in {3, 4}:
        raise RuntimeError("Expected input.glb output.glb category [bone_count]")
    bone_count = int(values[3]) if len(values) == 4 and values[3] else None
    return values[0], values[1], values[2], bone_count


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def select_only(obj):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def prepare_object_mesh(objects):
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    if not meshes:
        raise RuntimeError("El GLB del objeto no tiene ninguna malla usable")

    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)

    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    active = max(meshes, key=lambda obj: len(obj.data.vertices))
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    if len(meshes) > 1:
        bpy.ops.object.join()

    mesh = bpy.context.view_layer.objects.active
    mesh.name = "CLOUVA_Object"
    select_only(mesh)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return mesh


def build_bone_chain(mesh, attach_end, bone_count):
    """Crea un armature propio con `bone_count` huesos encadenados a lo largo del eje Z
    (altura) del objeto. El hueso mas cercano a `attach_end` es la raiz -- el que despues
    se conecta al avatar en attach_object.py."""
    mesh.matrix_world.identity()
    bpy.context.view_layer.update()
    corners = [mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box]
    z_values = [v.z for v in corners]
    z_min, z_max = min(z_values), max(z_values)
    center = Vector((
        sum(v.x for v in corners) / len(corners),
        sum(v.y for v in corners) / len(corners),
        0,
    ))

    if attach_end == "min":
        z_start, z_end = z_min, z_max
    else:
        z_start, z_end = z_max, z_min

    bone_count = max(2, bone_count)
    heights = [z_start + (z_end - z_start) * (i / bone_count) for i in range(bone_count + 1)]

    bpy.ops.object.armature_add(enter_editmode=True, location=(center.x, center.y, heights[0]))
    armature = bpy.context.object
    armature.name = "CLOUVA_Object_Rig"
    armature.data.name = "CLOUVA_Object_Rig"

    edit_bones = armature.data.edit_bones
    edit_bones.remove(edit_bones[0])  # el cubo de ejemplo que agrega armature_add

    names = []
    previous = None
    min_length = max((z_max - z_min) * 0.001, 0.001)
    for index in range(bone_count):
        name = "ObjectRoot" if index == 0 else f"ObjectBone{index}"
        bone = edit_bones.new(name)
        bone.head = (center.x, center.y, heights[index])
        tail_z = heights[index + 1]
        if abs(tail_z - heights[index]) < min_length:
            tail_z = heights[index] + (min_length if z_end >= z_start else -min_length)
        bone.tail = (center.x, center.y, tail_z)
        if previous is not None:
            bone.parent = previous
            bone.use_connect = True
        previous = bone
        names.append(name)

    bpy.ops.object.mode_set(mode="OBJECT")
    return armature, names, (z_min, z_max)


def skin_along_chain(mesh, armature, bone_names, z_range):
    """Pesa cada vertice segun su posicion en Z entre los huesos de la cadena (skinning
    lineal simple). Un objeto rigido queda casi todo pesado al hueso raiz; uno mas alargado
    se reparte de forma continua, permitiendo animacion secundaria mas adelante."""
    z_min, z_max = z_range
    span = max(z_max - z_min, 1e-6)
    bone_count = len(bone_names)

    for name in bone_names:
        mesh.vertex_groups.new(name=name)

    for vertex in mesh.data.vertices:
        world = mesh.matrix_world @ vertex.co
        t = (world.z - z_min) / span
        t = min(max(t, 0.0), 1.0)
        position = t * bone_count
        lower = min(int(position), bone_count - 1)
        upper = min(lower + 1, bone_count - 1)
        fraction = position - lower
        if lower == upper:
            mesh.vertex_groups[bone_names[lower]].add([vertex.index], 1.0, "REPLACE")
        else:
            mesh.vertex_groups[bone_names[lower]].add([vertex.index], 1.0 - fraction, "REPLACE")
            mesh.vertex_groups[bone_names[upper]].add([vertex.index], fraction, "REPLACE")

    modifier = mesh.modifiers.new(name="CLOUVA Object Rig", type="ARMATURE")
    modifier.object = armature
    mesh.parent = armature
    bpy.context.view_layer.update()


def export_glb(output_path, mesh, armature):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_all_influences=False,
    )


def main():
    input_path, output_path, category, bone_count_override = args()
    config = CATEGORY_RIG_CONFIG.get(category, DEFAULT_CONFIG)
    bone_count = bone_count_override or config["bone_count"]

    clear_scene()
    objects = import_glb(input_path)
    mesh = prepare_object_mesh(objects)
    armature, bone_names, z_range = build_bone_chain(mesh, config["attach_end"], bone_count)
    skin_along_chain(mesh, armature, bone_names, z_range)

    print(
        f"[rig-object] category={category} bones={bone_names} attach_end={config['attach_end']} "
        f"vertices={len(mesh.data.vertices)}",
        flush=True,
    )

    export_glb(output_path, mesh, armature)
    print(f"[rig-object] exported {output_path}", flush=True)


if __name__ == "__main__":
    main()
