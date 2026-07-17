import os
import sys
import tempfile

import bpy


VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"}


def args():
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) != 4:
        raise RuntimeError("Expected avatar.glb template.glb output.glb category")
    return values


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


def find_armature(objects, label):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"{label} has no armature")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def find_template_meshes(objects):
    meshes = [
        obj
        for obj in objects
        if obj.type == "MESH" and len(obj.data.vertices) >= 3 and len(obj.vertex_groups) > 0
    ]
    if not meshes:
        raise RuntimeError("Template GLB has no weighted meshes")
    return meshes


def weighted_ratio(mesh):
    count = len(mesh.data.vertices)
    if not count:
        return 0.0
    weighted = sum(1 for vertex in mesh.data.vertices if vertex.groups)
    return weighted / count


def validate_compatibility(meshes, target_armature):
    target_bones = {bone.name for bone in target_armature.data.bones}
    if not target_bones:
        raise RuntimeError("User avatar armature has no bones")

    for mesh in meshes:
        ratio = weighted_ratio(mesh)
        if ratio < 0.95:
            raise RuntimeError(
                f"Template mesh {mesh.name} is not fully weighted ({ratio:.1%})"
            )
        groups = {group.name for group in mesh.vertex_groups}
        overlap = groups & target_bones
        if not overlap:
            raise RuntimeError(
                f"Template mesh {mesh.name} has no vertex groups compatible with the active avatar"
            )
        missing = sorted(groups - target_bones)
        if missing:
            print(
                f"[template] mesh={mesh.name} ignored_non_bone_groups={missing[:20]}",
                flush=True,
            )
        print(
            f"[template] mesh={mesh.name} vertices={len(mesh.data.vertices)} "
            f"weighted={ratio:.3f} compatible_groups={len(overlap)}",
            flush=True,
        )


def rebind_to_avatar(meshes, target_armature, source_armatures):
    for mesh in meshes:
        world = mesh.matrix_world.copy()
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                mesh.modifiers.remove(modifier)

        modifier = mesh.modifiers.new(name="CLOUVA User Avatar", type="ARMATURE")
        modifier.object = target_armature
        modifier.use_vertex_groups = True

        mesh.parent = target_armature
        mesh.matrix_parent_inverse = target_armature.matrix_world.inverted()
        mesh.matrix_world = world
        mesh.hide_set(False)
        mesh.hide_viewport = False
        mesh.hide_render = False

    bpy.context.view_layer.update()

    for source in source_armatures:
        if source != target_armature and source.name in bpy.data.objects:
            bpy.data.objects.remove(source, do_unlink=True)

    bpy.context.view_layer.update()
    for mesh in meshes:
        if mesh.find_armature() != target_armature:
            raise RuntimeError(f"Template mesh {mesh.name} could not bind to the active avatar")


def export_glb(output_path, meshes, target_armature):
    bpy.ops.object.select_all(action="DESELECT")
    target_armature.hide_set(False)
    target_armature.hide_viewport = False
    target_armature.hide_render = False
    target_armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = target_armature
    bpy.context.view_layer.update()

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_skins=True,
        export_all_influences=False,
        export_materials="EXPORT",
    )


def validate_roundtrip(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("Processed template GLB is missing or empty")

    with tempfile.TemporaryDirectory(prefix="clouva-template-validate-"):
        clear_scene()
        imported = import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1:
            raise RuntimeError(
                f"Processed template must contain exactly one armature, found {len(armatures)}"
            )
        if not skinned:
            raise RuntimeError("Processed template has no skinned meshes")
        for mesh in skinned:
            ratio = weighted_ratio(mesh)
            if ratio < 0.95:
                raise RuntimeError(
                    f"Processed mesh {mesh.name} lost weights during export ({ratio:.1%})"
                )
        print(
            f"[template] roundtrip ok meshes={len(skinned)} "
            f"vertices={sum(len(obj.data.vertices) for obj in skinned)}",
            flush=True,
        )


def main():
    avatar_path, template_path, output_path, category = args()
    if category not in VALID_CATEGORIES:
        raise RuntimeError(f"Invalid category: {category}")

    clear_scene()
    avatar_objects = import_glb(avatar_path)
    target_armature = find_armature(avatar_objects, "Active user avatar")

    template_objects = import_glb(template_path)
    source_armatures = [obj for obj in template_objects if obj.type == "ARMATURE"]
    if not source_armatures:
        raise RuntimeError("Template GLB has no existing armature to preserve")

    meshes = find_template_meshes(template_objects)
    validate_compatibility(meshes, target_armature)
    rebind_to_avatar(meshes, target_armature, source_armatures)
    export_glb(output_path, meshes, target_armature)
    validate_roundtrip(output_path)


if __name__ == "__main__":
    main()
