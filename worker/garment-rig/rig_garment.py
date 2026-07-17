import bpy
import json
import os
import re
import sys
import tempfile
from math import radians

from mathutils import Vector
from mathutils.kdtree import KDTree

VALID_CATEGORIES = {"hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "hat", "accessory"}

BONE_ALIASES = {
    "hips": ["Hips", "mixamorig:Hips", "pelvis", "Pelvis", "Root"],
    "chest": ["Spine02", "Spine2", "Spine1", "mixamorig:Spine2", "chest", "Chest", "UpperChest"],
    "neck": ["neck", "Neck", "mixamorig:Neck"],
    "head": ["head", "Head", "mixamorig:Head", "J_Bip_C_Head", "Bip01 Head"],
    "left_shoulder": ["LeftShoulder", "mixamorig:LeftShoulder", "shoulder.L", "Shoulder_L"],
    "right_shoulder": ["RightShoulder", "mixamorig:RightShoulder", "shoulder.R", "Shoulder_R"],
    "left_up_leg": ["LeftUpLeg", "mixamorig:LeftUpLeg", "thigh.L", "UpLeg_L"],
    "left_foot": ["LeftFoot", "mixamorig:LeftFoot", "foot.L", "Foot_L"],
    "left_toe": ["LeftToeBase", "mixamorig:LeftToeBase", "toe.L"],
}

EXCLUDED_BODY_TOKENS = {
    "hair", "eye", "brow", "lash", "teeth", "tongue", "mouth", "shoe", "sock",
    "hoodie", "shirt", "jacket", "pants", "short", "cloth", "garment", "accessory",
    "hat", "cap",
}


def args():
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) not in {6, 7}:
        raise RuntimeError(
            "Expected avatar.glb garment.glb output.glb category art.png color [preview_settings_json]"
        )
    preview_settings = {}
    if len(values) == 7 and values[6]:
        try:
            decoded = json.loads(values[6])
            if isinstance(decoded, dict):
                preview_settings = decoded
        except json.JSONDecodeError as exc:
            raise RuntimeError("preview_settings_json is invalid") from exc
    return (*values[:6], preview_settings)


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


def clean_bone_name(value):
    text = str(value or "").lower()
    text = re.sub(r"^(mixamorig:|mixamorig_|armature\||bip01[\s_:.-]*)", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def find_armature(objects):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("Official avatar has no armature")
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
    """Fallback for rigs whose head bone uses an unknown generated name."""
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


def resolve_canonical_bone(armature, canonical):
    bone = find_pose_bone(armature, BONE_ALIASES[canonical])
    if bone is not None:
        return bone
    if canonical == "head":
        return infer_head_bone(armature)
    if canonical == "neck":
        head = infer_head_bone(armature)
        return head.parent if head is not None else None
    return None


def find_bone_world(armature, aliases):
    bone = find_pose_bone(armature, aliases)
    return armature.matrix_world @ bone.head if bone is not None else None


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
        meshes = [
            obj for obj in objects
            if obj.type == "MESH" and obj.find_armature() == armature and obj.vertex_groups
        ]
    if not meshes:
        raise RuntimeError("Official avatar has no usable skinned body meshes")
    print("[rig] body meshes", [(obj.name, len(obj.data.vertices)) for obj in meshes], flush=True)
    return meshes


def prepare_garment(objects):
    """Join every visible mesh while retaining original vertex groups for retargeting."""
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    source_armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("Garment GLB has no usable mesh")

    original_vertices = sum(len(obj.data.vertices) for obj in meshes)
    source_groups = sorted({group.name for obj in meshes for group in obj.vertex_groups})
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
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

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.000001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    for source_armature in source_armatures:
        if source_armature.name in bpy.data.objects:
            bpy.data.objects.remove(source_armature, do_unlink=True)

    final_vertices = len(garment.data.vertices)
    if final_vertices < max(50, int(original_vertices * 0.90)):
        raise RuntimeError(
            f"Garment geometry was unexpectedly reduced: {original_vertices} -> {final_vertices}"
        )
    print(
        f"[rig] garment parts={len(meshes)} vertices={final_vertices} "
        f"source_groups={source_groups[:30]}",
        flush=True,
    )
    return garment


def body_region(body_meshes, armature, category):
    body_min, body_max = combined_bbox(body_meshes)
    height = body_max.z - body_min.z
    hips = find_bone_world(armature, BONE_ALIASES["hips"])
    chest = find_bone_world(armature, BONE_ALIASES["chest"])
    neck = find_bone_world(armature, BONE_ALIASES["neck"])
    head_bone = resolve_canonical_bone(armature, "head")
    head = armature.matrix_world @ head_bone.head if head_bone is not None else None
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

    if category == "hat":
        anchor = head or neck
        if anchor is None:
            anchor = Vector(((body_min.x + body_max.x) * 0.5, (body_min.y + body_max.y) * 0.5, body_min.z + height * 0.88))
        center = Vector((anchor.x, anchor.y, anchor.z + height * 0.055))
        half = Vector((height * 0.115, height * 0.12, height * 0.085))
        return center - half, center + half

    return body_min, body_max


def clamp_number(value, minimum, maximum, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))


def fit_to_body(garment, body_meshes, armature, category):
    target_min, target_max = body_region(body_meshes, armature, category)
    target_size = target_max - target_min
    source_min, source_max = bbox_world(garment)
    source_size = source_max - source_min
    if min(target_size) <= 1e-6 or min(source_size) <= 1e-6:
        raise RuntimeError("Garment or target body region has invalid dimensions")

    padding = {
        "hoodie": Vector((1.18, 1.22, 1.08)),
        "shirt": Vector((1.10, 1.14, 1.04)),
        "jacket": Vector((1.22, 1.26, 1.10)),
        "pants": Vector((1.10, 1.14, 1.04)),
        "shorts": Vector((1.10, 1.14, 1.03)),
        "shoes": Vector((1.10, 1.15, 1.04)),
        "hat": Vector((1.12, 1.12, 1.03)),
        "accessory": Vector((1.05, 1.05, 1.05)),
    }[category]
    desired = Vector((
        target_size.x * padding.x,
        target_size.y * padding.y,
        target_size.z * padding.z,
    ))

    if category == "hat":
        uniform = min(
            desired.x / max(source_size.x, 1e-6),
            desired.y / max(source_size.y, 1e-6),
            desired.z / max(source_size.z, 1e-6),
        )
        garment.scale = Vector((uniform, uniform, uniform))
    else:
        uniform = desired.z / source_size.z
        x_fix = max(0.82, min(desired.x / (source_size.x * uniform), 1.24))
        y_fix = max(0.82, min(desired.y / (source_size.y * uniform), 1.24))
        garment.scale = Vector((uniform * x_fix, uniform * y_fix, uniform))

    bpy.context.view_layer.update()
    current_min, current_max = bbox_world(garment)
    current_center = (current_min + current_max) * 0.5
    target_center = (target_min + target_max) * 0.5
    if category in {"hoodie", "shirt", "jacket", "pants", "shorts"}:
        offset = Vector((
            target_center.x - current_center.x,
            target_center.y - current_center.y,
            target_max.z - current_max.z,
        ))
    elif category == "shoes":
        offset = Vector((
            target_center.x - current_center.x,
            target_center.y - current_center.y,
            target_min.z - current_min.z,
        ))
    else:
        offset = target_center - current_center
    garment.location += offset
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return target_min, target_max


def apply_preview_adjustments(garment, preview_settings):
    if not isinstance(preview_settings, dict):
        return
    adjustments = preview_settings.get("adjustments")
    if not isinstance(adjustments, dict):
        adjustments = {}

    fit = str(preview_settings.get("fit") or "Regular")
    fit_scale = 0.92 if fit == "Slim" else 1.10 if fit == "Oversize" else 1.0
    user_scale = clamp_number(adjustments.get("scale"), 25, 300, 100) / 100.0
    width = clamp_number(adjustments.get("width"), 35, 240, 100) / 100.0
    length = clamp_number(adjustments.get("length"), 35, 240, 100) / 100.0
    depth = clamp_number(1 + clamp_number(adjustments.get("distance"), -40, 60, 8) / 100.0, 0.5, 1.8, 1.08)
    x = clamp_number(adjustments.get("x"), -150, 150, 0) / 100.0
    vertical = (
        clamp_number(adjustments.get("y"), -150, 150, 0)
        + clamp_number(adjustments.get("height"), -100, 100, 0)
    ) / 100.0
    rotation = clamp_number(adjustments.get("rotation"), -180, 180, 0)

    garment.scale.x *= user_scale * fit_scale * width
    garment.scale.y *= user_scale * fit_scale * depth
    garment.scale.z *= user_scale * length
    garment.location.x += x
    garment.location.z += vertical
    garment.rotation_euler.z += radians(rotation)
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    print(
        f"[rig] preview adjustments fit={fit} scale={user_scale:.3f} "
        f"width={width:.3f} length={length:.3f} depth={depth:.3f} "
        f"x={x:.3f} vertical={vertical:.3f} rotation={rotation:.1f}",
        flush=True,
    )


def target_bone_lookup(armature):
    exact = {bone.name: bone.name for bone in armature.data.bones}
    normalized = {}
    for bone in armature.data.bones:
        normalized.setdefault(clean_bone_name(bone.name), bone.name)

    aliases = {}
    for canonical, names in BONE_ALIASES.items():
        target = resolve_canonical_bone(armature, canonical)
        if target is None:
            continue
        for name in [canonical, *names]:
            aliases[clean_bone_name(name)] = target.name
    return exact, normalized, aliases


def resolve_target_bone_name(source_name, lookups):
    exact, normalized, aliases = lookups
    if source_name in exact:
        return exact[source_name]
    cleaned = clean_bone_name(source_name)
    return normalized.get(cleaned) or aliases.get(cleaned)


def mapped_weight_snapshot(garment, armature):
    lookups = target_bone_lookup(armature)
    group_names = {group.index: group.name for group in garment.vertex_groups}
    snapshot = []
    mapped_vertices = 0
    for vertex in garment.data.vertices:
        weights = {}
        for membership in vertex.groups:
            source_name = group_names.get(membership.group)
            target_name = resolve_target_bone_name(source_name, lookups) if source_name else None
            if target_name and membership.weight > 0.0001:
                weights[target_name] = weights.get(target_name, 0.0) + membership.weight
        if weights:
            mapped_vertices += 1
        snapshot.append(weights)
    ratio = mapped_vertices / max(len(garment.data.vertices), 1)
    return snapshot, ratio


def apply_weight_snapshot(garment, snapshot):
    garment.vertex_groups.clear()
    names = sorted({name for weights in snapshot for name in weights})
    groups = {name: garment.vertex_groups.new(name=name) for name in names}
    for vertex, weights in zip(garment.data.vertices, snapshot):
        influences = sorted(weights.items(), key=lambda item: item[1], reverse=True)[:4]
        total = sum(value for _, value in influences)
        if total <= 0:
            continue
        for name, value in influences:
            groups[name].add([vertex.index], value / total, "REPLACE")


def retarget_existing_weights(garment, armature):
    if not garment.vertex_groups:
        return False
    snapshot, ratio = mapped_weight_snapshot(garment, armature)
    print(f"[rig] existing rig compatibility mapped_vertices={ratio:.3f}", flush=True)
    if ratio < 0.95:
        return False
    apply_weight_snapshot(garment, snapshot)
    return True


def filter_weights_to_anchor(garment, primary_name, secondary_name=None):
    allowed = {primary_name}
    if secondary_name:
        allowed.add(secondary_name)
    group_names = {group.index: group.name for group in garment.vertex_groups}
    snapshot = []
    weighted = 0
    primary = 0
    for vertex in garment.data.vertices:
        weights = {}
        for membership in vertex.groups:
            name = group_names.get(membership.group)
            if name in allowed and membership.weight > 0.0001:
                weights[name] = weights.get(name, 0.0) + membership.weight
        if weights:
            weighted += 1
        if weights.get(primary_name, 0) > 0.05:
            primary += 1
        snapshot.append(weights)
    count = max(len(garment.data.vertices), 1)
    if weighted / count < 0.95 or primary / count < 0.80:
        return False
    apply_weight_snapshot(garment, snapshot)
    return True


def assign_rigid_bone_weights(garment, armature, canonical):
    bone = resolve_canonical_bone(armature, canonical)
    if bone is None:
        raise RuntimeError(f"Avatar rig is missing required {canonical} bone")
    garment.vertex_groups.clear()
    group = garment.vertex_groups.new(name=bone.name)
    group.add(list(range(len(garment.data.vertices))), 1.0, "REPLACE")
    print(f"[rig] rigid anchor category_bone={bone.name} vertices={len(garment.data.vertices)}", flush=True)


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
    garment.vertex_groups.clear()
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
        influences = sorted(
            ((name, value / denominator) for name, value in blended.items()),
            key=lambda item: item[1],
            reverse=True,
        )[:4] if denominator else []
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
    """Keep original materials unless the job explicitly supplies artwork or a color."""
    if not (art_path and os.path.exists(art_path)) and not str(color or "").strip():
        print("[rig] preserving original materials", flush=True)
        return
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

    garment.data.materials.clear()
    garment.data.materials.append(material)


def attach_armature(garment, armature):
    for modifier in list(garment.modifiers):
        if modifier.type == "ARMATURE":
            garment.modifiers.remove(modifier)
    modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature
    world = garment.matrix_world.copy()
    garment.parent = armature
    garment.matrix_parent_inverse = armature.matrix_world.inverted()
    garment.matrix_world = world
    bpy.context.view_layer.update()


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
    ratios = Vector((
        garment_size.x / max(target_size.x, 1e-6),
        garment_size.y / max(target_size.y, 1e-6),
        garment_size.z / max(target_size.z, 1e-6),
    ))
    if ratios.x > 2.5 or ratios.y > 2.5 or ratios.z > 2.3:
        raise RuntimeError(f"Garment outside safe bounds: {tuple(round(v, 3) for v in ratios)}")


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
        print(
            f"[rig] roundtrip ok meshes={len(skinned)} "
            f"vertices={sum(len(obj.data.vertices) for obj in skinned)}",
            flush=True,
        )


def main():
    avatar_path, garment_path, output_path, category, art_path, color, preview_settings = args()
    if category not in VALID_CATEGORIES:
        raise RuntimeError(f"Invalid category: {category}")

    clear_scene()
    avatar_objects = import_glb(avatar_path)
    armature = find_armature(avatar_objects)
    body_meshes = body_meshes_for_rig(avatar_objects, armature)

    garment_objects = import_glb(garment_path)
    garment = prepare_garment(garment_objects)
    target_min, target_max = fit_to_body(garment, body_meshes, armature, category)
    apply_preview_adjustments(garment, preview_settings)

    reused_object_rig = retarget_existing_weights(garment, armature)
    strategy = "retarget_existing_weights" if reused_object_rig else "transfer_from_avatar"

    if category == "hat":
        head = resolve_canonical_bone(armature, "head")
        neck = resolve_canonical_bone(armature, "neck")
        if head is None:
            raise RuntimeError("Avatar rig has no Head bone for the gorra")
        preserved_head_rig = (
            reused_object_rig
            and filter_weights_to_anchor(garment, head.name, neck.name if neck else None)
        )
        if not preserved_head_rig:
            assign_rigid_bone_weights(garment, armature, "head")
            strategy = "rigid_head_anchor"
        else:
            strategy = "retarget_existing_head_weights"
    elif not reused_object_rig:
        copy_weights(body_meshes, garment)

    apply_material(garment, art_path, color)
    attach_armature(garment, armature)
    validate(garment, armature, target_min, target_max)
    print(f"[rig] final strategy={strategy} category={category}", flush=True)
    export_glb(output_path, garment, armature)
    validate_roundtrip(output_path)


if __name__ == "__main__":
    main()
