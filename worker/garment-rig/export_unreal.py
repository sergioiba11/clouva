import sys
from pathlib import Path

import bpy
from mathutils import Vector


def args_after_separator():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    return sys.argv[sys.argv.index("--") + 1 :]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_glb(path: Path):
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "ARMATURE"}]
    if not objects:
        raise RuntimeError("The GLB does not contain a mesh or armature")
    return objects


def world_bounds(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError("Could not calculate model dimensions")
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def set_rest_pose():
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            obj.data.pose_position = "REST"
            obj.animation_data_clear()


def scale_avatar_to_centimeters(objects, target_height_cm: float):
    minimum, maximum = world_bounds(objects)
    height = maximum.z - minimum.z
    if height <= 0.001:
        raise RuntimeError("Avatar height is invalid")
    scale_factor = target_height_cm / height
    roots = [obj for obj in objects if obj.parent is None or obj.parent not in objects]
    for obj in roots:
        obj.scale = tuple(value * scale_factor for value in obj.scale)
    bpy.context.view_layer.update()
    minimum, _ = world_bounds(objects)
    for obj in roots:
        obj.location.z -= minimum.z
    bpy.context.view_layer.update()
    return height, scale_factor


def prepare_object(objects):
    minimum, maximum = world_bounds(objects)
    roots = [obj for obj in objects if obj.parent is None or obj.parent not in objects]
    center = (minimum + maximum) * 0.5
    for obj in roots:
        obj.location.x -= center.x
        obj.location.y -= center.y
        obj.location.z -= minimum.z
    bpy.context.view_layer.update()
    size = maximum - minimum
    return size


def export_fbx(path: Path):
    bpy.ops.object.select_all(action="DESELECT")
    exportable = []
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "ARMATURE"}:
            obj.select_set(True)
            exportable.append(obj)
    if not exportable:
        raise RuntimeError("Nothing to export")
    bpy.context.view_layer.objects.active = next((obj for obj in exportable if obj.type == "ARMATURE"), exportable[0])
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        global_scale=1.0,
        apply_unit_scale=False,
        apply_scale_options="FBX_SCALE_NONE",
        use_space_transform=True,
        bake_space_transform=False,
        axis_forward="-Y",
        axis_up="Z",
        add_leaf_bones=False,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        armature_nodetype="NULL",
        use_armature_deform_only=True,
        bake_anim=False,
        path_mode="COPY",
        embed_textures=True,
    )


def main():
    values = args_after_separator()
    if len(values) < 2:
        raise RuntimeError("Usage: export_unreal.py input.glb output.fbx [target_height_cm] [mode]")
    source = Path(values[0]).resolve()
    output = Path(values[1]).resolve()
    target_height_cm = float(values[2]) if len(values) > 2 else 180.0
    mode = values[3].lower() if len(values) > 3 else "avatar"

    clear_scene()
    objects = import_glb(source)
    set_rest_pose()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "CENTIMETERS"
    scene.unit_settings.scale_length = 0.01

    if mode == "object":
        size = prepare_object(objects)
        summary = f"object_size=({size.x:.4f},{size.y:.4f},{size.z:.4f}) scale=preserved"
    else:
        if target_height_cm < 80 or target_height_cm > 260:
            raise RuntimeError("target_height_cm must be between 80 and 260")
        original_height, scale_factor = scale_avatar_to_centimeters(objects, target_height_cm)
        summary = f"original_height={original_height:.4f} target_height_cm={target_height_cm:.2f} scale_factor={scale_factor:.4f}"

    output.parent.mkdir(parents=True, exist_ok=True)
    export_fbx(output)
    if not output.exists() or output.stat().st_size < 1024:
        raise RuntimeError("FBX export was empty")
    print(f"[clouva-unreal] exported={output} mode={mode} {summary}", flush=True)


if __name__ == "__main__":
    main()
