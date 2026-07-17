"""Paso 2: 'Unir'. Toma un objeto YA rigeado (con su propio armature, salida de
rig_object.py) y el avatar, y los combina en un solo armature: reparenta el hueso raiz del
objeto (ObjectRoot) debajo del hueso correspondiente del avatar (Head/Neck/Chest/Hand),
posicionado exactamente ahi. A partir de ese momento el objeto sigue la animacion del avatar
solo, porque son huesos del mismo esqueleto.

Uso: blender --background --python attach_object.py -- avatar.glb rigged_object.glb output.glb category [side]
"""
import re
import sys

import bpy
from mathutils import Matrix

BONE_ALIASES = {
    "head": ["head", "Head", "mixamorig:Head", "J_Bip_C_Head", "Bip01 Head"],
    "neck": ["neck", "Neck", "mixamorig:Neck"],
    "chest": ["Spine02", "Spine2", "Spine1", "mixamorig:Spine2", "chest", "Chest", "UpperChest"],
    "left_hand": ["LeftHand", "mixamorig:LeftHand", "hand.L", "Hand_L"],
    "right_hand": ["RightHand", "mixamorig:RightHand", "hand.R", "Hand_R"],
}

# categoria del frontend -> hueso canonico del avatar al que se conecta el ObjectRoot
CATEGORY_TARGET_BONE = {
    "hat": "head",
    "cadena": "neck",
    "lentes": "head",
    "mochila": "chest",
    "aros": "head",
    "guantes": "hand",
    "pulseras": "hand",
    "anillos": "hand",
    "accessory": "chest",
}


def args():
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) not in {4, 5}:
        raise RuntimeError("Expected avatar.glb rigged_object.glb output.glb category [side]")
    side = values[4] if len(values) == 5 and values[4] else "right"
    return values[0], values[1], values[2], values[3], side


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


def clean_bone_name(value):
    text = str(value or "").lower()
    text = re.sub(r"^(mixamorig:|mixamorig_|armature\||bip01[\s_:.-]*)", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def find_armature(objects, exclude=None):
    armatures = [obj for obj in objects if obj.type == "ARMATURE" and obj is not exclude]
    if not armatures:
        raise RuntimeError("No se encontro ningun armature en el GLB")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def find_pose_bone(armature, aliases):
    exact = {bone.name: bone for bone in armature.pose.bones}
    for name in aliases:
        if name in exact:
            return exact[name]
    normalized = {clean_bone_name(bone.name): bone for bone in armature.pose.bones}
    for name in aliases:
        bone = normalized.get(clean_bone_name(name))
        if bone is not None:
            return bone
    return None


def infer_head_bone(armature):
    candidates = []
    excluded = ("hand", "finger", "thumb", "toe", "foot", "weapon", "eye")
    for bone in armature.pose.bones:
        cleaned = clean_bone_name(bone.name)
        if any(token in cleaned for token in excluded):
            continue
        world_head = armature.matrix_world @ bone.head
        world_tail = armature.matrix_world @ bone.tail
        candidates.append((max(world_head.z, world_tail.z), -len(bone.children), bone))
    return max(candidates, key=lambda item: (item[0], item[1]))[2] if candidates else None


def resolve_target_bone(armature, category, side):
    canonical = CATEGORY_TARGET_BONE.get(category, "chest")
    if canonical == "hand":
        aliases = BONE_ALIASES["left_hand"] if side == "left" else BONE_ALIASES["right_hand"]
        bone = find_pose_bone(armature, aliases)
        if bone is not None:
            return bone
        canonical = "chest"  # fallback razonable si el avatar no tiene manos nombradas

    bone = find_pose_bone(armature, BONE_ALIASES[canonical])
    if bone is not None:
        return bone
    if canonical == "head":
        return infer_head_bone(armature)
    if canonical == "neck":
        head = infer_head_bone(armature)
        return head.parent if head is not None else None
    return infer_head_bone(armature)


def find_object_root(armature):
    for name in ("ObjectRoot",):
        if name in armature.pose.bones:
            return armature.pose.bones[name]
    # fallback: el hueso sin padre (raiz) del armature del objeto
    roots = [bone for bone in armature.pose.bones if bone.parent is None]
    if not roots:
        raise RuntimeError("El objeto rigeado no tiene un hueso raiz (ObjectRoot)")
    return roots[0]


def reposition_object_rig(object_armature, object_root_pose_bone, target_world_matrix):
    """Mueve/orienta TODO el rig del objeto para que la cabeza del hueso ObjectRoot quede
    exactamente en la posicion y orientacion del hueso del avatar al que se va a conectar."""
    object_armature.matrix_world.identity()
    bpy.context.view_layer.update()
    local_head = object_root_pose_bone.head.copy()
    object_armature.matrix_world = target_world_matrix @ Matrix.Translation(-local_head)
    bpy.context.view_layer.update()

    select_only(object_armature)
    for child in object_armature.children:
        child.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def select_only(obj):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join_armatures_and_reparent(avatar_armature, object_armature, target_bone_name, root_bone_name):
    object_meshes = [child for child in object_armature.children if child.type == "MESH"]

    bpy.ops.object.select_all(action="DESELECT")
    object_armature.select_set(True)
    avatar_armature.select_set(True)
    bpy.context.view_layer.objects.active = avatar_armature
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active

    # bpy.ops.object.join en armatures puede dejar los modifiers de malla apuntando al
    # objeto que desaparecio en la union; hay que volver a apuntarlos al sobreviviente.
    for mesh in object_meshes:
        for modifier in mesh.modifiers:
            if modifier.type == "ARMATURE":
                modifier.object = joined
        if mesh.parent != joined:
            world = mesh.matrix_world.copy()
            mesh.parent = joined
            mesh.matrix_world = world

    select_only(joined)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = joined.data.edit_bones
    root_bone = edit_bones.get(root_bone_name)
    target_bone = edit_bones.get(target_bone_name)
    if root_bone is None or target_bone is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError(f"No se pudo reparentar: root={root_bone_name} target={target_bone_name}")
    root_bone.parent = target_bone
    root_bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    return joined


def export_glb(output_path, armature):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for child in armature.children:
        child.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_skins=True,
        export_all_influences=False,
    )


def main():
    avatar_path, object_path, output_path, category, side = args()

    clear_scene()
    avatar_objects = import_glb(avatar_path)
    avatar_armature = find_armature(avatar_objects)

    object_objects = import_glb(object_path)
    object_armature = find_armature(object_objects)
    object_root_pose_bone = find_object_root(object_armature)
    root_bone_name = object_root_pose_bone.name

    target_pose_bone = resolve_target_bone(avatar_armature, category, side)
    if target_pose_bone is None:
        raise RuntimeError(f"El avatar no tiene un hueso valido para category={category}")
    target_world_matrix = avatar_armature.matrix_world @ target_pose_bone.matrix
    target_bone_name = target_pose_bone.name

    reposition_object_rig(object_armature, object_root_pose_bone, target_world_matrix)

    print(
        f"[attach-object] category={category} side={side} target_bone={target_bone_name} "
        f"object_root={root_bone_name}",
        flush=True,
    )

    joined = join_armatures_and_reparent(avatar_armature, object_armature, target_bone_name, root_bone_name)
    export_glb(output_path, joined)
    print(f"[attach-object] exported {output_path}", flush=True)


if __name__ == "__main__":
    main()
