import importlib.util
import math
import os
import sys

from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v18.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V18 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v18", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V18")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9


ARM_PAIRS = (
    ("left_shoulder", "right_shoulder"),
    ("left_upper_arm", "right_upper_arm"),
    ("left_lower_arm", "right_lower_arm"),
    ("left_hand", "right_hand"),
)


def resolved_arm_pairs(armature):
    pairs = []
    for left_key, right_key in ARM_PAIRS:
        left = legacy.resolve_bone(armature, left_key)
        right = legacy.resolve_bone(armature, right_key)
        if left is not None and right is not None and left.name != right.name:
            pairs.append((left, right))
    if not pairs:
        raise RuntimeError("No se pudieron resolver dos cadenas de brazo distintas para las mangas")
    return pairs


def principal_axis_xy(points, center):
    if len(points) < 2:
        return Vector((1.0, 0.0, 0.0))
    xx = yy = xy = 0.0
    for point in points:
        dx = float(point.x - center.x)
        dy = float(point.y - center.y)
        xx += dx * dx
        yy += dy * dy
        xy += dx * dy
    angle = 0.5 * math.atan2(2.0 * xy, xx - yy)
    axis = Vector((math.cos(angle), math.sin(angle), 0.0))
    return axis.normalized() if axis.length > 1e-12 else Vector((1.0, 0.0, 0.0))


def lateral_selection(projections, target_count):
    ordered = sorted(projections, key=lambda item: item[1])
    target_count = max(1, min(int(target_count), max(1, len(ordered) // 3)))
    right = [index for index, _value in ordered[:target_count]]
    left = [index for index, _value in ordered[-target_count:]]
    return left, right


def group_weight(group, vertex_index):
    try:
        return float(group.weight(vertex_index))
    except RuntimeError:
        return 0.0


def ensure_group(garment, name):
    group = garment.vertex_groups.get(name)
    return group if group is not None else garment.vertex_groups.new(name=name)


def transfer_opposite_arm_weights(garment, vertex_indices, source_to_target):
    groups = {group.name: group for group in garment.vertex_groups}
    target_groups = {
        target_name: ensure_group(garment, target_name)
        for _source_name, target_name in source_to_target
    }
    moved_vertices = 0
    for vertex_index in vertex_indices:
        moved = 0.0
        for source_name, target_name in source_to_target:
            source = groups.get(source_name)
            weight = group_weight(source, vertex_index) if source is not None else 0.0
            if source is not None:
                source.remove([vertex_index])
            if weight > 0.0:
                target_groups[target_name].add([vertex_index], weight, "ADD")
                moved += weight
        if moved > 0.0:
            moved_vertices += 1
    return moved_vertices


def force_side_weight(garment, vertex_indices, opposite_names, target_name, weight=0.85):
    groups = {group.name: group for group in garment.vertex_groups}
    target = ensure_group(garment, target_name)
    for vertex_index in vertex_indices:
        for name in opposite_names:
            group = groups.get(name)
            if group is not None:
                group.remove([vertex_index])
        target.add([vertex_index], float(weight), "REPLACE")


def ensure_upper_arm_weights_v19(garment, armature):
    pairs = resolved_arm_pairs(armature)
    left_names = {left.name for left, _right in pairs}
    right_names = {right.name for _left, right in pairs}
    if left_names & right_names:
        raise RuntimeError("Las cadenas izquierda y derecha del avatar comparten el mismo hueso")

    vertex_count = len(garment.data.vertices)
    minimum = max(6, int(vertex_count * 0.004))
    left_count = legacy.group_vertex_count(garment, left_names, threshold=0.025)
    right_count = legacy.group_vertex_count(garment, right_names, threshold=0.025)
    if left_count >= minimum and right_count >= minimum:
        return

    left_upper = legacy.resolve_bone(armature, "left_upper_arm")
    right_upper = legacy.resolve_bone(armature, "right_upper_arm")
    if left_upper is None or right_upper is None or left_upper.name == right_upper.name:
        raise RuntimeError("El avatar no tiene dos huesos superiores de brazo distintos")

    minimum_box, maximum_box = legacy.bbox_world(garment)
    garment_center = (minimum_box + maximum_box) * 0.5
    world_points = [garment.matrix_world @ vertex.co for vertex in garment.data.vertices]

    left_center = armature.matrix_world @ left_upper.center
    right_center = armature.matrix_world @ right_upper.center
    arm_axis = Vector((left_center.x - right_center.x, left_center.y - right_center.y, 0.0))
    if arm_axis.length <= 1e-10:
        arm_axis = principal_axis_xy(world_points, garment_center)
    else:
        arm_axis.normalize()

    projections = [
        (index, float((point - garment_center).dot(arm_axis)))
        for index, point in enumerate(world_points)
    ]
    repair_count = max(minimum * 4, int(vertex_count * 0.08))
    left_indices, right_indices = lateral_selection(projections, repair_count)

    left_to_right = [(left.name, right.name) for left, right in pairs]
    right_to_left = [(right.name, left.name) for left, right in pairs]

    moved_left = transfer_opposite_arm_weights(garment, left_indices, right_to_left)
    moved_right = transfer_opposite_arm_weights(garment, right_indices, left_to_right)

    # Cuando la transferencia original puso pesos de torso (o ningún peso de brazo),
    # garantizamos una influencia explícita en cada extremo de la prenda.
    force_side_weight(
        garment,
        left_indices,
        right_names,
        left_upper.name,
        weight=0.85 if moved_left < minimum else 0.45,
    )
    force_side_weight(
        garment,
        right_indices,
        left_names,
        right_upper.name,
        weight=0.85 if moved_right < minimum else 0.45,
    )

    v9.normalize_vertex_groups(garment)
    left_after = legacy.group_vertex_count(garment, left_names, threshold=0.025)
    right_after = legacy.group_vertex_count(garment, right_names, threshold=0.025)

    if left_after < minimum or right_after < minimum:
        raise RuntimeError(
            "No se pudo separar geométricamente las dos mangas: "
            f"left={left_after}, right={right_after}, minimum={minimum}"
        )

    garment["clouvaSleeveRepairVersion"] = 19
    garment["clouvaSleeveRepairAxis"] = "geometry_projection"
    garment["clouvaSleeveLeftWeighted"] = int(left_after)
    garment["clouvaSleeveRightWeighted"] = int(right_after)
    print(
        "[rig-v19] bilateral sleeve repair passed "
        f"before=({left_count},{right_count}) after=({left_after},{right_after}) "
        f"selected=({len(left_indices)},{len(right_indices)}) "
        f"moved=({moved_left},{moved_right}) axis={tuple(round(float(v), 6) for v in arm_axis)}",
        flush=True,
    )


v9.ensure_upper_arm_weights = ensure_upper_arm_weights_v19


if __name__ == "__main__":
    v9.main()
