import importlib.util
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v29.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V40 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v40_active", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V40")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9

ANATOMICAL_FIT_VERSION = 41
RIG_ERROR = previous.RIG_ERROR
PREBIND_SPACE_VERSION = previous.PREBIND_SPACE_VERSION
SPACE_CONTRACT_VERSION = previous.SPACE_CONTRACT_VERSION
MAX_GARMENT_POLYGONS = previous.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION

_original_copy_weights = legacy.copy_weights


def _as_array(value):
    return np.asarray((float(value.x), float(value.y), float(value.z)), dtype=np.float64)


def _vector(value):
    return Vector((float(value[0]), float(value[1]), float(value[2])))


def _finite_point(value):
    return value is not None and all(math.isfinite(float(component)) for component in value)


def _bone_point(armature, canonical, mode="head"):
    if mode == "center":
        point = legacy.bone_center_world(armature, canonical)
    elif mode == "tail":
        point = legacy.bone_tail_world(armature, canonical)
    else:
        point = legacy.bone_head_world(armature, canonical)
    return _as_array(point) if _finite_point(point) else None


def _fallback_point(*values):
    for value in values:
        if value is not None and np.isfinite(value).all():
            return value
    return None


def _body_point_cloud(body_meshes):
    clouds = []
    for mesh in body_meshes:
        points = previous.evaluated_world_points(mesh)
        if len(points):
            clouds.append(np.asarray(points, dtype=np.float64))
    if not clouds:
        raise RuntimeError(RIG_ERROR)
    points = np.vstack(clouds)
    if points.ndim != 2 or points.shape[1] != 3 or not np.isfinite(points).all():
        raise RuntimeError(RIG_ERROR)
    return points


def _garment_world_points(garment):
    matrix = garment.matrix_world
    return np.asarray(
        [tuple(matrix @ vertex.co) for vertex in garment.data.vertices],
        dtype=np.float64,
    )


def _smoothstep(edge0, edge1, value):
    if abs(edge1 - edge0) < 1e-9:
        return 1.0 if value >= edge1 else 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def _nearest_on_polyline(point, polyline):
    best_point = None
    best_distance = float("inf")
    best_progress = 0.0
    lengths = [
        float(np.linalg.norm(polyline[index + 1] - polyline[index]))
        for index in range(len(polyline) - 1)
    ]
    total = max(sum(lengths), 1e-8)
    traversed = 0.0
    for index, length in enumerate(lengths):
        start = polyline[index]
        end = polyline[index + 1]
        direction = end - start
        denominator = float(np.dot(direction, direction))
        if denominator <= 1e-12:
            traversed += length
            continue
        t = max(0.0, min(1.0, float(np.dot(point - start, direction) / denominator)))
        candidate = start + direction * t
        distance = float(np.linalg.norm(point - candidate))
        if distance < best_distance:
            best_distance = distance
            best_point = candidate
            best_progress = (traversed + length * t) / total
        traversed += length
    if best_point is None:
        best_point = polyline[0]
        best_distance = float(np.linalg.norm(point - best_point))
    return best_point, best_distance, best_progress


def _robust_profile(points, z_value, band, center_x, maximum_half_width, fallback):
    mask = np.abs(points[:, 2] - z_value) <= band
    mask &= np.abs(points[:, 0] - center_x) <= maximum_half_width
    section = points[mask]
    if len(section) < 16:
        return fallback
    x05, x50, x95 = np.quantile(section[:, 0], [0.05, 0.50, 0.95])
    y05, y50, y95 = np.quantile(section[:, 1], [0.05, 0.50, 0.95])
    return {
        "center_x": float(x50),
        "center_y": float(y50),
        "half_x": max(float((x95 - x05) * 0.5), 1e-5),
        "half_y": max(float((y95 - y05) * 0.5), 1e-5),
    }


def _interpolate_profile(profiles, z_value):
    if z_value <= profiles[0]["z"]:
        return profiles[0]
    if z_value >= profiles[-1]["z"]:
        return profiles[-1]
    for left, right in zip(profiles, profiles[1:]):
        if left["z"] <= z_value <= right["z"]:
            denominator = max(right["z"] - left["z"], 1e-8)
            t = (z_value - left["z"]) / denominator
            return {
                "z": z_value,
                "center_x": left["center_x"] * (1.0 - t) + right["center_x"] * t,
                "center_y": left["center_y"] * (1.0 - t) + right["center_y"] * t,
                "half_x": left["half_x"] * (1.0 - t) + right["half_x"] * t,
                "half_y": left["half_y"] * (1.0 - t) + right["half_y"] * t,
                "source_center_x": left["source_center_x"] * (1.0 - t) + right["source_center_x"] * t,
                "source_center_y": left["source_center_y"] * (1.0 - t) + right["source_center_y"] * t,
                "source_half_x": left["source_half_x"] * (1.0 - t) + right["source_half_x"] * t,
                "source_half_y": left["source_half_y"] * (1.0 - t) + right["source_half_y"] * t,
            }
    return profiles[-1]


def _landmarks(armature):
    hips = _fallback_point(
        _bone_point(armature, "hips", "center"),
        _bone_point(armature, "spine", "head"),
    )
    chest = _fallback_point(
        _bone_point(armature, "chest", "center"),
        _bone_point(armature, "spine", "tail"),
    )
    neck = _fallback_point(
        _bone_point(armature, "neck", "head"),
        _bone_point(armature, "head", "head"),
    )
    head = _fallback_point(
        _bone_point(armature, "head", "center"),
        neck,
    )
    left_shoulder = _fallback_point(
        _bone_point(armature, "left_upper_arm", "head"),
        _bone_point(armature, "left_shoulder", "head"),
    )
    right_shoulder = _fallback_point(
        _bone_point(armature, "right_upper_arm", "head"),
        _bone_point(armature, "right_shoulder", "head"),
    )
    left_elbow = _fallback_point(
        _bone_point(armature, "left_lower_arm", "head"),
        _bone_point(armature, "left_upper_arm", "tail"),
    )
    right_elbow = _fallback_point(
        _bone_point(armature, "right_lower_arm", "head"),
        _bone_point(armature, "right_upper_arm", "tail"),
    )
    left_wrist = _fallback_point(
        _bone_point(armature, "left_hand", "head"),
        _bone_point(armature, "left_lower_arm", "tail"),
    )
    right_wrist = _fallback_point(
        _bone_point(armature, "right_hand", "head"),
        _bone_point(armature, "right_lower_arm", "tail"),
    )
    required = (
        hips,
        chest,
        neck,
        left_shoulder,
        right_shoulder,
        left_elbow,
        right_elbow,
        left_wrist,
        right_wrist,
    )
    if any(value is None or not np.isfinite(value).all() for value in required):
        raise RuntimeError(RIG_ERROR)
    return {
        "hips": hips,
        "chest": chest,
        "neck": neck,
        "head": head,
        "left_arm": [left_shoulder, left_elbow, left_wrist],
        "right_arm": [right_shoulder, right_elbow, right_wrist],
        "left_shoulder": left_shoulder,
        "right_shoulder": right_shoulder,
    }


def _fit_margins(category):
    if category == "shirt":
        return 1.08, 1.12, 1.10
    if category == "jacket":
        return 1.18, 1.22, 1.25
    return 1.14, 1.18, 1.20


def refine_upper_fit_v41(body_meshes, garment, armature, category):
    if category not in v9.UPPER_GARMENTS:
        return None
    if garment is None or garment.type != "MESH" or armature is None:
        raise RuntimeError(RIG_ERROR)

    legacy.bpy.context.view_layer.update()
    body_points = _body_point_cloud(body_meshes)
    source_points = _garment_world_points(garment)
    if len(source_points) < 50 or not np.isfinite(source_points).all():
        raise RuntimeError(RIG_ERROR)

    marks = _landmarks(armature)
    hips = marks["hips"]
    chest = marks["chest"]
    neck = marks["neck"]
    shoulder_span = float(np.linalg.norm(marks["left_shoulder"] - marks["right_shoulder"]))
    torso_height = float(np.linalg.norm(neck - hips))
    if shoulder_span < 1e-5 or torso_height < 1e-5:
        raise RuntimeError(RIG_ERROR)

    body_min = body_points.min(axis=0)
    body_max = body_points.max(axis=0)
    avatar_height = max(float(body_max[2] - body_min[2]), torso_height, 1e-5)
    center_x = float((hips[0] + chest[0] + neck[0]) / 3.0)
    center_y = float((hips[1] + chest[1] + neck[1]) / 3.0)
    band = max(torso_height * 0.075, avatar_height * 0.025)
    margin_x, margin_y, sleeve_margin = _fit_margins(category)

    fallback_body = {
        "center_x": center_x,
        "center_y": center_y,
        "half_x": shoulder_span * 0.28,
        "half_y": avatar_height * 0.055,
    }
    profiles = []
    for z_value in np.linspace(float(hips[2]), float(neck[2]), 9):
        body_profile = _robust_profile(
            body_points,
            float(z_value),
            band,
            center_x,
            shoulder_span * 0.72,
            fallback_body,
        )
        source_profile = _robust_profile(
            source_points,
            float(z_value),
            band * 1.20,
            center_x,
            shoulder_span * 0.92,
            {
                "center_x": float(np.median(source_points[:, 0])),
                "center_y": float(np.median(source_points[:, 1])),
                "half_x": max(float(np.quantile(np.abs(source_points[:, 0] - center_x), 0.62)), shoulder_span * 0.30),
                "half_y": max(float(np.quantile(np.abs(source_points[:, 1] - center_y), 0.75)), avatar_height * 0.06),
            },
        )
        profiles.append({
            "z": float(z_value),
            "center_x": body_profile["center_x"],
            "center_y": body_profile["center_y"],
            "half_x": body_profile["half_x"] * margin_x,
            "half_y": body_profile["half_y"] * margin_y,
            "source_center_x": source_profile["center_x"],
            "source_center_y": source_profile["center_y"],
            "source_half_x": source_profile["half_x"],
            "source_half_y": source_profile["half_y"],
        })

    torso_mask = (
        (source_points[:, 2] >= hips[2] - torso_height * 0.18)
        & (source_points[:, 2] <= neck[2] + torso_height * 0.08)
        & (np.abs(source_points[:, 0] - center_x) <= shoulder_span * 0.72)
    )
    if int(torso_mask.sum()) < max(24, int(len(source_points) * 0.05)):
        raise RuntimeError(RIG_ERROR)
    source_torso_min_z = float(source_points[torso_mask, 2].min())
    source_torso_max_z = float(source_points[torso_mask, 2].max())
    source_torso_height = max(source_torso_max_z - source_torso_min_z, 1e-5)
    target_bottom_z = float(hips[2] - torso_height * 0.055)
    target_top_z = float(neck[2] + torso_height * 0.025)

    hood_mask = (
        (source_points[:, 2] >= neck[2] - torso_height * 0.10)
        & (np.abs(source_points[:, 0] - center_x) <= shoulder_span * 0.82)
    )
    hood_points = source_points[hood_mask]
    hood_source_center = hood_points.mean(axis=0) if len(hood_points) >= 8 else neck.copy()
    hood_source_half_x = (
        max(float(np.quantile(np.abs(hood_points[:, 0] - hood_source_center[0]), 0.92)), 1e-5)
        if len(hood_points) >= 8 else shoulder_span * 0.35
    )
    hood_source_half_y = (
        max(float(np.quantile(np.abs(hood_points[:, 1] - hood_source_center[1]), 0.92)), 1e-5)
        if len(hood_points) >= 8 else avatar_height * 0.08
    )
    hood_target_center = np.array((
        float(neck[0]),
        float(neck[1]),
        float(neck[2] + torso_height * 0.10),
    ))
    hood_target_half_x = shoulder_span * (0.42 if category == "hoodie" else 0.34)
    hood_target_half_y = max(profiles[-1]["half_y"] * 1.35, avatar_height * 0.07)

    corrected = source_points.copy()
    sleeve_counts = {"left": 0, "right": 0}
    for index, point in enumerate(source_points):
        profile = _interpolate_profile(profiles, float(point[2]))
        sx = max(0.48, min(1.22, profile["half_x"] / max(profile["source_half_x"], 1e-5)))
        sy = max(0.48, min(1.25, profile["half_y"] / max(profile["source_half_y"], 1e-5)))
        torso_target = point.copy()
        torso_target[0] = profile["center_x"] + (point[0] - profile["source_center_x"]) * sx
        torso_target[1] = profile["center_y"] + (point[1] - profile["source_center_y"]) * sy
        normalized_z = max(0.0, min(1.0, (point[2] - source_torso_min_z) / source_torso_height))
        mapped_z = target_bottom_z + normalized_z * (target_top_z - target_bottom_z)
        torso_target[2] = point[2] * 0.35 + mapped_z * 0.65

        left_projection, left_distance, left_progress = _nearest_on_polyline(point, marks["left_arm"])
        right_projection, right_distance, right_progress = _nearest_on_polyline(point, marks["right_arm"])
        if left_distance <= right_distance:
            arm_projection, arm_distance, arm_progress, side = left_projection, left_distance, left_progress, "left"
        else:
            arm_projection, arm_distance, arm_progress, side = right_projection, right_distance, right_progress, "right"

        outer_ratio = abs(float(point[0] - center_x)) / max(shoulder_span * 0.5, 1e-5)
        arm_proximity = 1.0 - _smoothstep(shoulder_span * 0.26, shoulder_span * 0.56, arm_distance)
        outer_weight = _smoothstep(0.52, 0.92, outer_ratio)
        sleeve_weight = max(0.0, min(1.0, arm_proximity * outer_weight))
        sleeve_target = point.copy()
        radial = point - arm_projection
        radial_length = float(np.linalg.norm(radial))
        target_radius = shoulder_span * (0.135 - 0.035 * arm_progress) * sleeve_margin
        if radial_length > 1e-7:
            radius_factor = max(0.42, min(1.18, target_radius / radial_length))
            sleeve_target = arm_projection + radial * radius_factor
        else:
            sleeve_target = arm_projection
        sleeve_target = point * 0.15 + sleeve_target * 0.85
        if sleeve_weight > 0.35:
            sleeve_counts[side] += 1

        hood_height_weight = _smoothstep(
            float(neck[2] - torso_height * 0.10),
            float(neck[2] + torso_height * 0.10),
            float(point[2]),
        )
        hood_center_weight = 1.0 - _smoothstep(
            shoulder_span * 0.48,
            shoulder_span * 0.82,
            abs(float(point[0] - center_x)),
        )
        hood_weight = max(0.0, min(1.0, hood_height_weight * hood_center_weight))
        hood_target = point.copy()
        hood_sx = max(0.55, min(1.10, hood_target_half_x / hood_source_half_x))
        hood_sy = max(0.55, min(1.12, hood_target_half_y / hood_source_half_y))
        hood_target[0] = hood_target_center[0] + (point[0] - hood_source_center[0]) * hood_sx
        hood_target[1] = hood_target_center[1] + (point[1] - hood_source_center[1]) * hood_sy
        hood_target[2] = point[2] + (hood_target_center[2] - hood_source_center[2]) * 0.75

        blended = torso_target * (1.0 - sleeve_weight) + sleeve_target * sleeve_weight
        blended = blended * (1.0 - hood_weight) + hood_target * hood_weight
        corrected[index] = point * 0.12 + blended * 0.88

    if min(sleeve_counts.values()) < max(12, int(len(source_points) * 0.002)):
        raise RuntimeError(RIG_ERROR)

    inverse_world = garment.matrix_world.inverted()
    for vertex, world in zip(garment.data.vertices, corrected):
        vertex.co = inverse_world @ _vector(world)
    garment.data.update()
    legacy.bpy.context.view_layer.update()

    report = validate_upper_fit_v41(body_meshes, garment, armature, category)
    report["sleeveVertices"] = sleeve_counts
    garment["clouvaAnatomicalFitVersion"] = ANATOMICAL_FIT_VERSION
    garment["clouvaAnatomicalFitReport"] = json.dumps(report, separators=(",", ":"))
    print(
        "[rig-v41] anatomical upper fit applied "
        f"category={category} centerError={report['centerError']:.4f} "
        f"widthRatio={report['widthRatio']:.4f} "
        f"leftSleeve={report['leftSleeveMedian']:.4f} "
        f"rightSleeve={report['rightSleeveMedian']:.4f}",
        flush=True,
    )
    return report


def validate_upper_fit_v41(body_meshes, garment, armature, category):
    if category not in v9.UPPER_GARMENTS:
        return {}
    body_points = _body_point_cloud(body_meshes)
    points = _garment_world_points(garment)
    marks = _landmarks(armature)
    hips = marks["hips"]
    neck = marks["neck"]
    shoulder_span = max(float(np.linalg.norm(marks["left_shoulder"] - marks["right_shoulder"])), 1e-5)
    torso_height = max(float(np.linalg.norm(neck - hips)), 1e-5)
    center_x = float((hips[0] + marks["chest"][0] + neck[0]) / 3.0)
    center_y = float((hips[1] + marks["chest"][1] + neck[1]) / 3.0)

    torso = points[
        (points[:, 2] >= hips[2] - torso_height * 0.12)
        & (points[:, 2] <= neck[2] + torso_height * 0.06)
        & (np.abs(points[:, 0] - center_x) <= shoulder_span * 0.70)
    ]
    if len(torso) < 24:
        raise RuntimeError(RIG_ERROR)
    torso_center = np.median(torso, axis=0)
    center_error = float(np.linalg.norm(torso_center[:2] - np.array((center_x, center_y)))) / shoulder_span

    chest_z = float(marks["chest"][2])
    band = max(torso_height * 0.08, 1e-5)
    body_profile = _robust_profile(
        body_points,
        chest_z,
        band,
        center_x,
        shoulder_span * 0.72,
        {
            "center_x": center_x,
            "center_y": center_y,
            "half_x": shoulder_span * 0.28,
            "half_y": torso_height * 0.08,
        },
    )
    garment_profile = _robust_profile(
        torso,
        chest_z,
        band * 1.25,
        center_x,
        shoulder_span * 0.70,
        {
            "center_x": float(torso_center[0]),
            "center_y": float(torso_center[1]),
            "half_x": shoulder_span * 0.45,
            "half_y": torso_height * 0.12,
        },
    )
    width_ratio = garment_profile["half_x"] / max(body_profile["half_x"], 1e-5)

    left_distances = []
    right_distances = []
    for point in points:
        _, left_distance, _ = _nearest_on_polyline(point, marks["left_arm"])
        _, right_distance, _ = _nearest_on_polyline(point, marks["right_arm"])
        outer_ratio = abs(float(point[0] - center_x)) / max(shoulder_span * 0.5, 1e-5)
        if outer_ratio < 0.72:
            continue
        if left_distance <= right_distance:
            left_distances.append(left_distance)
        else:
            right_distances.append(right_distance)
    if len(left_distances) < 8 or len(right_distances) < 8:
        raise RuntimeError(RIG_ERROR)
    left_median = float(np.median(left_distances)) / shoulder_span
    right_median = float(np.median(right_distances)) / shoulder_span

    garment_min = points.min(axis=0)
    garment_max = points.max(axis=0)
    torso_min_z = float(torso[:, 2].min())
    hem_error = abs(torso_min_z - float(hips[2] - torso_height * 0.055)) / torso_height
    top_limit = float((marks["head"][2] if marks["head"] is not None else neck[2]) + torso_height * 0.35)
    if (
        not all(math.isfinite(value) for value in (center_error, width_ratio, left_median, right_median, hem_error))
        or center_error > 0.22
        or width_ratio < 0.82
        or width_ratio > (1.48 if category == "hoodie" else 1.35)
        or left_median > 0.34
        or right_median > 0.34
        or hem_error > 0.28
        or float(garment_max[2]) > top_limit
    ):
        raise RuntimeError(RIG_ERROR)
    return {
        "version": ANATOMICAL_FIT_VERSION,
        "category": category,
        "centerError": center_error,
        "widthRatio": width_ratio,
        "leftSleeveMedian": left_median,
        "rightSleeveMedian": right_median,
        "hemError": hem_error,
        "garmentBounds": {
            "min": [float(value) for value in garment_min],
            "max": [float(value) for value in garment_max],
        },
    }


def copy_weights_anatomical_v41(body_meshes, garment, armature, category):
    if category in v9.UPPER_GARMENTS:
        refine_upper_fit_v41(body_meshes, garment, armature, category)
    return _original_copy_weights(body_meshes, garment, armature, category)


legacy.copy_weights = copy_weights_anatomical_v41

# Re-export V40 contracts and retained diagnostics.
normalize_official_avatar_before_weights_v40 = previous.normalize_official_avatar_before_weights_v40
validate_unreal_avatar_reference_v40 = previous.validate_unreal_avatar_reference_v40
prepare_garment_fresh_v40 = previous.prepare_garment_fresh_v40
export_glb_v40 = previous.export_glb_v40
validate_roundtrip_v40 = previous.validate_roundtrip_v40
normalize_shared_space_v39 = previous.normalize_shared_space_v39
validate_deformation_envelope_v39 = previous.validate_deformation_envelope_v39
evaluated_world_points = previous.evaluated_world_points
shape_signature = previous.shape_signature
validate_shape_metrics = previous.validate_shape_metrics
garment_signature = previous.garment_signature
validate_anchor_metrics = previous.validate_anchor_metrics
validate_signature = previous.validate_signature
reduce_object_polygons = previous.reduce_object_polygons


def production_main():
    return previous.main()


main = production_main


if __name__ == "__main__":
    main()
