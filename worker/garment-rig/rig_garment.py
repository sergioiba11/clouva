import bpy
import os
import sys
import tempfile
from mathutils import Vector
from mathutils.kdtree import KDTree

VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"}

BONE_ALIASES = {
    "hips": ["Hips", "mixamorig:Hips", "pelvis", "Pelvis"],
    "chest": ["Spine02", "Spine2", "Spine1", "mixamorig:Spine2", "chest", "Chest"],
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
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) != 6:
        raise RuntimeError("Expected avatar.glb garment.glb output.glb category art.png color")
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
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise RuntimeError("Cannot calculate an empty bounding box")
    return (
        Vector((min(v.x for v in points), min(v.y for v in points), min(v.z for v in points))),
        Vector((max(v.x for v in points), max(v.y for v in points), max(v.z for v in points))),
    )


def find_bone_world(armature, aliases):
    for name in aliases:
        bone = armature.pose.bones.get(name)
        if bone is not None:
            return armature.matrix_world @ bone.head
    return None


def body_meshes_for_rig(objects, armature):
    meshes = []
    for obj in objects:
        if obj.type != "MESH" or len(obj.data.vertices) < 20 or obj.find_armature() != armature:
            continue
        if any(token in obj.name.lower() for token in EXCLUDED_BODY_TOKENS):
            continue
        if obj.vertex_groups:
            meshes.append(obj)
    if not meshes:
        meshes = [obj for obj in objects if obj.type == "MESH" and obj.find_armature() == armature and obj.vertex_groups]
    if not meshes:
        raise RuntimeError("Official avatar has no usable skinned body meshes")
    print("[rig] body meshes", [(obj.name, len(obj.data.vertices)) for obj in meshes], flush=True)
    return meshes


def prepare_garment(objects):
    """Keep every Meshy mesh part. Never delete disconnected islands automatically."""
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    if not meshes:
        raise RuntimeError("Garment GLB has no usable mesh")

    original_vertices = sum(len(obj.data.vertices) for obj in meshes)
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

    # Do not use select_loose/delete. Meshy often creates valid sleeves, cuffs,
    # hood and torso as disconnected geometry islands.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.000001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    final_vertices = len(garment.data.vertices)
    if final_vertices < max(50, int(original_vertices * 0.90)):
        raise RuntimeError(f"Garment geometry was unexpectedly reduced: {original_vertices} -> {final_vertices}")
    print(f"[rig] garment parts={len(meshes)} vertices={final_vertices}", flush=True)
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
        top = neck or left_shoulder or chest
        top_z = top.z if top else body_min.z + height * 0.82
        if left_shoulder and right_shoulder:
            center_x = (left_shoulder.x + right_shoulder.x) * 0.5
            half_width = abs(right_shoulder.x - left_shoulder.x) * 0.78
            min_x, max_x = center_x - half_width, center_x + half_width
        else:
            min_x, max_x = body_min.x, body_max.x
        center_y = (body_min.y + body_max.y) * 0.5
        half_y = (body_max.y - body_min.y) * 0.42
        return Vector((min_x, center_y - half_y, bottom_z)), Vector((max_x, center_y + half_y, top_z))

    if category in {"pants", "shorts"}:
        top_z = hips.z if hips else body_min.z + height * 0.48
        bottom_z = foot.z if foot else body_min.z
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
    source_min, source_max = bbox_world(garment)
    source_size = source_max - source_min
    if min(target_size) <= 1e-6 or min(source_size) <= 1e-6:
        raise RuntimeError("Garment or target body region has invalid dimensions")

    padding = {
        "hoodie": Vector((1.18, 1.22, 1.08)), "shirt": Vector((1.10, 1.14, 1.04)),
        "jacket": Vector((1.22, 1.26, 1.10)), "pants": Vector((1.10, 1.14, 1.04)),
        "shorts": Vector((1.10, 1.14, 1.03)), "shoes": Vector((1.10, 1.15, 1.04)),
        "accessory": Vector((1.05, 1.05, 1.05)),
    }[category]
    desired = Vector((target_size.x * padding.x, target_size.y * padding.y, target_size.z * padding.z))
    uniform = desired.z / source_size.z
    x_fix = max(0.82, min(desired.x / (source_size.x * uniform), 1.24))
    y_fix = max(0.82, min(desired.y / (source_size.y * uniform), 1.24))
    garment.scale = Vector((uniform * x_fix, uniform * y_fix, uniform))
    bpy.context.view_layer.update()

    current_min, current_max = bbox_world(garment)
    current_center = (current_min + current_max) * 0.5
    target_center = (target_min + target_max) * 0.5
    if category in {"hoodie", "shirt", "jacket", "pants", "shorts"}:
        offset = Vector((target_center.x - current_center.x, target_center.y - current_center.y, target_max.z - current_max.z))
    elif category == "shoes":
        offset = Vector((target_center.x - current_center.x, target_center.y - current_center.y, target_min.z - current_min.z))
    else:
        offset = target_center - current_center
    garment.location += offset
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return target_min, target_max


def build_weight_kdtree(body_meshes):
    total = sum(len(obj.data.vertices) for obj in body_meshes)
    kd = KDTree(total)
    records = []
    index = 0
    for obj in body_meshes:
        names = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            kd.insert(obj.matrix_world @ vertex.co, index)
            records.append((vertex, names))
            index += 1
    kd.balance()
    return kd, records


def copy_weights(body_meshes, garment):
    names = sorted({group.name for obj in body_meshes for group in obj.vertex_groups})
    destination = {name: garment.vertex_groups.new(name=name) for name in names}
    kd, records = build_weight_kdtree(body_meshes)
    for vertex in garment.data.vertices:
        world = garment.matrix_world @ vertex.co
        blended = {}
        denominator = 0.0
        for _position, record_index, distance in kd.find_n(world, 8):
            source, source_names = records[record_index]
            factor = 1.0 / max(distance, 1e-5) ** 2
            denominator += factor
            for membership in source.groups:
                name = source_names.get(membership.group)
                if name and membership.weight > 0.0001:
                    blended[name] = blended.get(name, 0.0) + membership.weight * factor
        influences = sorted(((name, value / denominator) for name, value in blended.items()), key=lambda item: item[1], reverse=True)[:4] if denominator else []
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
    """Keep garment opaque. PNG alpha masks artwork, never the garment itself."""
    ensure_uv_map(garment)
    material = bpy.data.materials.new(name="CLOUVA_Garment_Material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.72
    shader.inputs["Alpha"].default_value = 1.0
    base = nodes.new("ShaderNodeRGB")
    base.outputs[0].default_value = hex_to_rgba(color)
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    if art_path and os.path.exists(art_path):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(art_path, check_existing=False)
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MIX"
        links.new(texture.outputs["Alpha"], mix.inputs["Fac"])
        links.new(base.outputs["Color"], mix.inputs[1])
        links.new(texture.outputs["Color"], mix.inputs[2])
        links.new(mix.outputs["Color"], shader.inputs["Base Color"])
    else:
        links.new(base.outputs["Color"], shader.inputs["Base Color"])

    material.surface_render_method = "DITHERED" if False else "DITHERED"
    shader.inputs["Alpha"].default_value = 1.0
    garment.data.materials.clear()
    garment.data.materials.append(material)


def validate(garment, armature, target_min, target_max):
    count = len(garment.data.vertices)
    if count < 50:
        raise RuntimeError("Garment mesh is too small")
    weighted = sum(1 for vertex in garment.data.vertices if vertex.groups)
    if weighted / count < 0.995:
        raise RuntimeError(f"Only {weighted}/{count} vertices received weights")
    if garment.find_armature() != armature:
        raise RuntimeError("Garment is not connected to official armature")
    garment_min, garment_max = bbox_world(garment)
    target_size = target_max - target_min
    garment_size = garment_max - garment_min
    ratios = Vector((garment_size.x / target_size.x, garment_size.y / target_size.y, garment_size.z / target_size.z))
    if ratios.x > 2.0 or ratios.y > 2.2 or ratios.z > 1.7:
        raise RuntimeError(f"Garment outside safe bounds: {tuple(round(v, 3) for v in ratios)}")


def export_glb(output_path, garment, armature):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    garment.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(filepath=output_path, export_format="GLB", use_selection=True, export_apply=False,
                              export_animations=True, export_skins=True, export_all_influences=False,
                              export_materials="EXPORT")


def validate_roundtrip(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("Exported GLB is missing or empty")
    with tempfile.TemporaryDirectory(prefix="clouva-validate-"):
        clear_scene()
        imported = import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("Exported GLB is not a valid single-rig wearable")
        materials = [slot.material for obj in skinned for slot in obj.material_slots if slot.material]
        for material in materials:
            if material.diffuse_color[3] < 0.99:
                raise RuntimeError("Exported garment material became transparent")
        print(f"[rig] roundtrip ok meshes={len(skinned)} vertices={sum(len(o.data.vertices) for o in skinned)}", flush=True)


def main():
    avatar_path, garment_path, output_path, category, art_path, color = args()
    if category not in VALID_CATEGORIES:
        raise RuntimeError(f"Invalid category: {category}")
    clear_scene()
    avatar_objects = import_glb(avatar_path)
    armature = find_armature(avatar_objects)
    body_meshes = body_meshes_for_rig(avatar_objects, armature)
    garment = prepare_garment(import_glb(garment_path))
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

    validate(garment, armature, target_min, target_max)
    export_glb(output_path, garment, armature)
    validate_roundtrip(output_path)


if __name__ == "__main__":
    main()
