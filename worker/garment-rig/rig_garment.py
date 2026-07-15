import bpy
import os
import sys
import tempfile
from mathutils import Vector
from mathutils.kdtree import KDTree


VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"}

BONE_ALIASES = {
    "hips": ["Hips", "mixamorig:Hips", "pelvis", "Pelvis"],
    "spine": ["Spine", "Spine01", "Spine1", "mixamorig:Spine"],
    "chest": ["Spine02", "Spine2", "mixamorig:Spine2", "chest", "Chest"],
    "neck": ["neck", "Neck", "mixamorig:Neck"],
    "left_shoulder": ["LeftShoulder", "mixamorig:LeftShoulder", "shoulder.L", "Shoulder_L"],
    "right_shoulder": ["RightShoulder", "mixamorig:RightShoulder", "shoulder.R", "Shoulder_R"],
    "left_up_leg": ["LeftUpLeg", "mixamorig:LeftUpLeg", "thigh.L", "UpLeg_L"],
    "left_foot": ["LeftFoot", "mixamorig:LeftFoot", "foot.L", "Foot_L"],
    "left_toe": ["LeftToeBase", "mixamorig:LeftToeBase", "toe.L"],
}

EXCLUDED_BODY_TOKENS = {
    "hair", "eye", "brow", "lash", "teeth", "tongue", "mouth", "shoe", "sock",
    "hoodie", "shirt", "jacket", "pants", "short", "cloth", "garment", "accessory",
}


def args():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 6:
        raise RuntimeError("Expected avatar.glb garment.glb output.glb category art.png color")
    return values


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


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


def find_armature(objects):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("Official avatar has no armature")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def bbox_world(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners))),
        Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners))),
    )


def combined_bbox(objects):
    points = []
    for obj in objects:
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError("Cannot calculate an empty bounding box")
    return (
        Vector((min(v.x for v in points), min(v.y for v in points), min(v.z for v in points))),
        Vector((max(v.x for v in points), max(v.y for v in points), max(v.z for v in points))),
    )


def find_bone_world(armature, aliases):
    for name in aliases:
        pose_bone = armature.pose.bones.get(name)
        if pose_bone is not None:
            return armature.matrix_world @ pose_bone.head
    return None


def body_meshes_for_rig(objects, armature):
    candidates = []
    for obj in objects:
        if obj.type != "MESH" or len(obj.data.vertices) < 20:
            continue
        if obj.find_armature() != armature:
            continue
        lowered = obj.name.lower()
        if any(token in lowered for token in EXCLUDED_BODY_TOKENS):
            continue
        if len(obj.vertex_groups) == 0:
            continue
        candidates.append(obj)

    if not candidates:
        candidates = [
            obj for obj in objects
            if obj.type == "MESH" and obj.find_armature() == armature and len(obj.vertex_groups) > 0
        ]
    if not candidates:
        raise RuntimeError("Official avatar has no usable skinned body meshes")

    print("[rig] body meshes:", [(obj.name, len(obj.data.vertices), len(obj.vertex_groups)) for obj in candidates], flush=True)
    return candidates


def remove_small_islands(obj):
    """Remove tiny disconnected fragments without deleting sleeves or hood pieces."""
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_loose()
    bpy.ops.object.mode_set(mode="OBJECT")

    selected = [v for v in obj.data.vertices if v.select]
    threshold = max(8, int(len(obj.data.vertices) * 0.002))
    if 0 < len(selected) <= threshold:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.delete(type="VERT")
        bpy.ops.object.mode_set(mode="OBJECT")


def prepare_garment(objects):
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    if not meshes:
        raise RuntimeError("Garment GLB has no usable mesh")

    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        obj.vertex_groups.clear()
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False

    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    active = max(meshes, key=lambda obj: len(obj.data.vertices))
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    if len(meshes) > 1:
        bpy.ops.object.join()

    garment = bpy.context.view_layer.objects.active
    garment.name = "CLOUVA_Garment"
    select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    for obj in list(objects):
        if obj != garment and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    remove_small_islands(garment)
    select_only(garment)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.00001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    print(f"[rig] garment parts={len(meshes)} vertices={len(garment.data.vertices)}", flush=True)
    return garment


def body_region(body_meshes, armature, category):
    body_min, body_max = combined_bbox(body_meshes)
    height = body_max.z - body_min.z
    hips = find_bone_world(armature, BONE_ALIASES["hips"])
    chest = find_bone_world(armature, BONE_ALIASES["chest"])
    neck = find_bone_world(armature, BONE_ALIASES["neck"])
    left_shoulder = find_bone_world(armature, BONE_ALIASES["left_shoulder"])
    right_shoulder = find_bone_world(armature, BONE_ALIASES["right_shoulder"])
    up_leg = find_bone_world(armature, BONE_ALIASES["left_up_leg"])
    foot = find_bone_world(armature, BONE_ALIASES["left_foot"])
    toe = find_bone_world(armature, BONE_ALIASES["left_toe"])

    if category in {"hoodie", "shirt", "jacket"}:
        bottom_z = hips.z if hips else body_min.z + height * 0.43
        top_anchor = neck or left_shoulder or chest
        top_z = top_anchor.z if top_anchor else body_min.z + height * 0.82
        if left_shoulder and right_shoulder:
            center_x = (left_shoulder.x + right_shoulder.x) * 0.5
            half_width = abs(right_shoulder.x - left_shoulder.x) * 0.72
            min_x, max_x = center_x - half_width, center_x + half_width
        else:
            min_x, max_x = body_min.x, body_max.x
        depth_center = (body_min.y + body_max.y) * 0.5
        depth_half = (body_max.y - body_min.y) * 0.36
        return Vector((min_x, depth_center - depth_half, bottom_z)), Vector((max_x, depth_center + depth_half, top_z))

    if category in {"pants", "shorts"}:
        top_z = hips.z if hips else body_min.z + height * 0.48
        bottom_z = (foot.z if foot else body_min.z)
        if category == "shorts":
            thigh_z = up_leg.z if up_leg else body_min.z + height * 0.33
            bottom_z = thigh_z - (top_z - thigh_z) * 0.35
        return Vector((body_min.x, body_min.y, bottom_z)), Vector((body_max.x, body_max.y, top_z))

    if category == "shoes":
        top_z = (toe.z if toe else (foot.z if foot else body_min.z)) + height * 0.10
        return Vector((body_min.x, body_min.y, body_min.z)), Vector((body_max.x, body_max.y, top_z))

    return body_min, body_max


def fit_to_body(garment, body_meshes, armature, category):
    target_min, target_max = body_region(body_meshes, armature, category)
    target_size = target_max - target_min
    garment_min, garment_max = bbox_world(garment)
    garment_size = garment_max - garment_min
    if min(target_size) <= 1e-6 or min(garment_size) <= 1e-6:
        raise RuntimeError("Garment or target body region has invalid dimensions")

    padding = {
        "hoodie": Vector((1.18, 1.24, 1.06)),
        "shirt": Vector((1.10, 1.16, 1.03)),
        "jacket": Vector((1.22, 1.28, 1.08)),
        "pants": Vector((1.10, 1.14, 1.04)),
        "shorts": Vector((1.10, 1.14, 1.03)),
        "shoes": Vector((1.10, 1.15, 1.04)),
        "accessory": Vector((1.05, 1.05, 1.05)),
    }[category]

    desired = Vector((target_size.x * padding.x, target_size.y * padding.y, target_size.z * padding.z))

    # Height is the most stable signal for CLOUVA garments. Use a uniform base
    # scale first, then only small bounded X/Y corrections. This prevents a Meshy
    # hoodie from being stretched into a broken crop-top or giant shoulder ring.
    uniform = desired.z / garment_size.z
    x_correction = max(0.78, min((desired.x / (garment_size.x * uniform)), 1.28))
    y_correction = max(0.78, min((desired.y / (garment_size.y * uniform)), 1.28))
    garment.scale = Vector((uniform * x_correction, uniform * y_correction, uniform))
    bpy.context.view_layer.update()

    garment_min, garment_max = bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    target_center = (target_min + target_max) * 0.5

    if category in {"hoodie", "shirt", "jacket"}:
        # Anchor upper garments at shoulders/neck, while preserving their full
        # generated length. This fixes the previous upward collapse.
        target_top = target_max.z
        offset_z = target_top - garment_max.z
        offset = Vector((target_center.x - garment_center.x, target_center.y - garment_center.y, offset_z))
    elif category in {"pants", "shorts"}:
        offset = Vector((target_center.x - garment_center.x, target_center.y - garment_center.y, target_max.z - garment_max.z))
    elif category == "shoes":
        offset = Vector((target_center.x - garment_center.x, target_center.y - garment_center.y, target_min.z - garment_min.z))
    else:
        offset = target_center - garment_center

    garment.location += offset
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.update()

    final_min, final_max = bbox_world(garment)
    print(
        f"[rig] fit category={category} target={tuple(round(v,4) for v in target_size)} "
        f"source={tuple(round(v,4) for v in garment_size)} uniform={uniform:.5f} "
        f"xy=({x_correction:.3f},{y_correction:.3f}) offset={tuple(round(v,4) for v in offset)} "
        f"final=({tuple(round(v,4) for v in final_min)}, {tuple(round(v,4) for v in final_max)})",
        flush=True,
    )
    return target_min, target_max


def build_weight_kdtree(body_meshes):
    total_vertices = sum(len(obj.data.vertices) for obj in body_meshes)
    kd = KDTree(total_vertices)
    records = []
    index = 0
    for obj in body_meshes:
        group_names = {group.index: group.name for group in obj.vertex_groups}
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            kd.insert(matrix @ vertex.co, index)
            records.append((vertex, group_names))
            index += 1
    kd.balance()
    return kd, records


def copy_weights(body_meshes, garment):
    all_names = sorted({group.name for obj in body_meshes for group in obj.vertex_groups})
    if not all_names:
        raise RuntimeError("Avatar body has no vertex groups")
    garment.vertex_groups.clear()
    destination = {name: garment.vertex_groups.new(name=name) for name in all_names}
    kd, records = build_weight_kdtree(body_meshes)

    for vertex in garment.data.vertices:
        world_position = garment.matrix_world @ vertex.co
        neighbors = kd.find_n(world_position, 8)
        blended = {}
        total_distance_weight = 0.0
        for _position, record_index, distance in neighbors:
            source_vertex, names = records[record_index]
            distance_weight = 1.0 / max(distance, 1e-5) ** 2
            total_distance_weight += distance_weight
            for membership in source_vertex.groups:
                name = names.get(membership.group)
                if name and membership.weight > 0.0001:
                    blended[name] = blended.get(name, 0.0) + membership.weight * distance_weight

        if not blended or total_distance_weight <= 0:
            continue
        influences = sorted(
            ((name, value / total_distance_weight) for name, value in blended.items()),
            key=lambda item: item[1],
            reverse=True,
        )[:4]
        total = sum(value for _, value in influences) or 1.0
        for name, value in influences:
            destination[name].add([vertex.index], value / total, "REPLACE")


def hex_to_rgba(value):
    value = (value or "#0a0a0a").strip().lstrip("#")
    if len(value) != 6:
        value = "0a0a0a"
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)) + (1.0,)


def ensure_uv_map(obj):
    if obj.data.uv_layers:
        return
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15192, island_margin=0.02, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def apply_material(garment, art_path, color):
    ensure_uv_map(garment)
    material = bpy.data.materials.new(name="CLOUVA_Garment_Material")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = hex_to_rgba(color)
    shader.inputs["Roughness"].default_value = 0.72

    if art_path and os.path.exists(art_path):
        texture = material.node_tree.nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(art_path, check_existing=False)
        material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        if texture.outputs.get("Alpha"):
            material.node_tree.links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
            material.surface_render_method = "DITHERED"

    garment.data.materials.clear()
    garment.data.materials.append(material)


def validate_before_export(garment, armature, target_min, target_max):
    vertex_count = len(garment.data.vertices)
    if vertex_count < 50:
        raise RuntimeError("Garment mesh is too small")
    weighted = sum(1 for vertex in garment.data.vertices if len(vertex.groups) > 0)
    if weighted / vertex_count < 0.995:
        raise RuntimeError(f"Only {weighted}/{vertex_count} garment vertices received skin weights")
    if garment.find_armature() != armature:
        raise RuntimeError("Garment is not connected to the official avatar armature")

    garment_min, garment_max = bbox_world(garment)
    target_size = target_max - target_min
    garment_size = garment_max - garment_min
    ratios = Vector((garment_size.x / target_size.x, garment_size.y / target_size.y, garment_size.z / target_size.z))
    if ratios.x > 2.0 or ratios.y > 2.2 or ratios.z > 1.65:
        raise RuntimeError(f"Garment remains outside safe target bounds: ratios={tuple(round(v,3) for v in ratios)}")


def export_glb(output_path, garment, armature):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    garment.select_set(True)
    bpy.context.view_layer.objects.active = armature
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


def validate_export_roundtrip(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("Exported GLB is missing or empty")

    with tempfile.TemporaryDirectory(prefix="clouva-validate-"):
        clear_scene()
        imported = import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        meshes = [obj for obj in imported if obj.type == "MESH"]
        skinned = [obj for obj in meshes if obj.find_armature() is not None]
        if len(armatures) != 1:
            raise RuntimeError(f"Exported GLB must contain exactly one armature, found {len(armatures)}")
        if not skinned:
            raise RuntimeError("Exported GLB has no skinned garment mesh")
        if sum(len(obj.data.vertices) for obj in skinned) < 50:
            raise RuntimeError("Exported skinned garment is unexpectedly small")
        print(f"[rig] roundtrip ok armatures={len(armatures)} skinned_meshes={len(skinned)}", flush=True)


def main():
    avatar_path, garment_path, output_path, category, art_path, color = args()
    if category not in VALID_CATEGORIES:
        raise RuntimeError(f"Invalid category: {category}")

    clear_scene()
    avatar_objects = import_glb(avatar_path)
    armature = find_armature(avatar_objects)
    body_meshes = body_meshes_for_rig(avatar_objects, armature)

    garment_objects = import_glb(garment_path)
    garment = prepare_garment(garment_objects)
    target_min, target_max = fit_to_body(garment, body_meshes, armature, category)
    copy_weights(body_meshes, garment)
    apply_material(garment, art_path, color)

    modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature
    world = garment.matrix_world.copy()
    garment.parent = armature
    garment.matrix_parent_inverse = armature.matrix_world.inverted()
    garment.matrix_world = world
    bpy.context.view_layer.update()

    validate_before_export(garment, armature, target_min, target_max)
    export_glb(output_path, garment, armature)
    validate_export_roundtrip(output_path)


if __name__ == "__main__":
    main()
