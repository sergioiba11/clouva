import importlib.util
import json
import math
import os
import sys

import numpy as np


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v30.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V41 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v41_active", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V41")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9

ANATOMICAL_FIT_VERSION = 42
RIG_ERROR = previous.RIG_ERROR
PREBIND_SPACE_VERSION = previous.PREBIND_SPACE_VERSION
SPACE_CONTRACT_VERSION = previous.SPACE_CONTRACT_VERSION
MAX_GARMENT_POLYGONS = previous.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION

_original_copy_weights = previous._original_copy_weights
_original_validate_upper_fit = previous.validate_upper_fit_v41


def _reject(stage, **metrics):
    encoded = json.dumps(metrics, separators=(",", ":"), default=float)
    print(f"[rig-v42] anatomical validation rejected stage={stage} metrics={encoded}", flush=True)
    raise RuntimeError(RIG_ERROR)


def _arm_candidates(points, marks, center_x, shoulder_span, torso_height):
    left = []
    right = []
    neck_z = float(marks["neck"][2])
    arm_points = marks["left_arm"] + marks["right_arm"]
    minimum_z = min(float(point[2]) for point in arm_points) - torso_height * 0.16
    maximum_z = max(float(point[2]) for point in arm_points) + torso_height * 0.10

    for point in points:
        z_value = float(point[2])
        if z_value < minimum_z or z_value > maximum_z or z_value > neck_z + torso_height * 0.10:
            continue
        outer_ratio = abs(float(point[0] - center_x)) / max(shoulder_span * 0.5, 1e-5)
        if outer_ratio < 0.56:
            continue

        _, left_distance, left_progress = previous._nearest_on_polyline(point, marks["left_arm"])
        _, right_distance, right_progress = previous._nearest_on_polyline(point, marks["right_arm"])
        if left_distance <= right_distance:
            if left_progress >= 0.0 and left_distance <= shoulder_span * 0.62:
                left.append(float(left_distance))
        else:
            if right_progress >= 0.0 and right_distance <= shoulder_span * 0.62:
                right.append(float(right_distance))
    return left, right


def _robust_arm_distance(values, shoulder_span):
    if len(values) < 8:
        return float("inf")
    ordered = np.sort(np.asarray(values, dtype=np.float64))
    retained = ordered[: max(8, int(math.ceil(len(ordered) * 0.70)))]
    return float(np.quantile(retained, 0.65)) / max(shoulder_span, 1e-5)


def validate_upper_fit_v42(body_meshes, garment, armature, category):
    if category not in v9.UPPER_GARMENTS:
        return {}

    body_points = previous._body_point_cloud(body_meshes)
    points = previous._garment_world_points(garment)
    marks = previous._landmarks(armature)
    hips = marks["hips"]
    neck = marks["neck"]
    shoulder_span = max(float(np.linalg.norm(marks["left_shoulder"] - marks["right_shoulder"])), 1e-5)
    torso_height = max(float(np.linalg.norm(neck - hips)), 1e-5)
    center_x = float((hips[0] + marks["chest"][0] + neck[0]) / 3.0)
    center_y = float((hips[1] + marks["chest"][1] + neck[1]) / 3.0)

    torso = points[
        (points[:, 2] >= hips[2] - torso_height * 0.15)
        & (points[:, 2] <= neck[2] + torso_height * 0.08)
        & (np.abs(points[:, 0] - center_x) <= shoulder_span * 0.72)
    ]
    if len(torso) < 24:
        _reject("torso-vertices", vertices=len(torso))

    torso_center = np.median(torso, axis=0)
    center_error = float(np.linalg.norm(torso_center[:2] - np.array((center_x, center_y)))) / shoulder_span
    chest_z = float(marks["chest"][2])
    band = max(torso_height * 0.08, 1e-5)
    body_profile = previous._robust_profile(
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
    garment_profile = previous._robust_profile(
        torso,
        chest_z,
        band * 1.25,
        center_x,
        shoulder_span * 0.72,
        {
            "center_x": float(torso_center[0]),
            "center_y": float(torso_center[1]),
            "half_x": shoulder_span * 0.45,
            "half_y": torso_height * 0.12,
        },
    )
    width_ratio = garment_profile["half_x"] / max(body_profile["half_x"], 1e-5)

    left_values, right_values = _arm_candidates(points, marks, center_x, shoulder_span, torso_height)
    left_distance = _robust_arm_distance(left_values, shoulder_span)
    right_distance = _robust_arm_distance(right_values, shoulder_span)

    garment_min = points.min(axis=0)
    garment_max = points.max(axis=0)
    torso_min_z = float(torso[:, 2].min())
    hem_error = abs(torso_min_z - float(hips[2] - torso_height * 0.055)) / torso_height
    is_hoodie = category == "hoodie"
    head_z = float(marks["head"][2] if marks["head"] is not None else neck[2])
    top_limit = head_z + torso_height * (0.65 if is_hoodie else 0.45)
    arm_limit = 0.42 if is_hoodie else 0.36
    center_limit = 0.30 if is_hoodie else 0.24
    width_limit = 1.62 if is_hoodie else 1.42
    hem_limit = 0.38 if is_hoodie else 0.30

    metrics = {
        "category": category,
        "centerError": center_error,
        "widthRatio": width_ratio,
        "leftSleeveDistance": left_distance,
        "rightSleeveDistance": right_distance,
        "leftSleeveCandidates": len(left_values),
        "rightSleeveCandidates": len(right_values),
        "hemError": hem_error,
        "garmentTop": float(garment_max[2]),
        "topLimit": top_limit,
    }
    if not all(math.isfinite(value) for value in (center_error, width_ratio, left_distance, right_distance, hem_error)):
        _reject("non-finite", **metrics)
    if center_error > center_limit:
        _reject("center", **metrics)
    if width_ratio < 0.78 or width_ratio > width_limit:
        _reject("width", **metrics)
    if left_distance > arm_limit or right_distance > arm_limit:
        _reject("sleeves", **metrics)
    if hem_error > hem_limit:
        _reject("hem", **metrics)
    if float(garment_max[2]) > top_limit:
        _reject("hood-top", **metrics)

    report = {
        "version": ANATOMICAL_FIT_VERSION,
        "category": category,
        "centerError": center_error,
        "widthRatio": width_ratio,
        "leftSleeveMedian": left_distance,
        "rightSleeveMedian": right_distance,
        "leftSleeveCandidates": len(left_values),
        "rightSleeveCandidates": len(right_values),
        "hemError": hem_error,
        "garmentBounds": {
            "min": [float(value) for value in garment_min],
            "max": [float(value) for value in garment_max],
        },
    }
    print(f"[rig-v42] anatomical validation passed metrics={json.dumps(report, separators=(',', ':'))}", flush=True)
    return report


def refine_upper_fit_v42(body_meshes, garment, armature, category):
    previous.validate_upper_fit_v41 = validate_upper_fit_v42
    report = previous.refine_upper_fit_v41(body_meshes, garment, armature, category)
    if report is not None:
        report["version"] = ANATOMICAL_FIT_VERSION
        garment["clouvaAnatomicalFitVersion"] = ANATOMICAL_FIT_VERSION
        garment["clouvaAnatomicalFitReport"] = json.dumps(report, separators=(",", ":"))
    return report


def copy_weights_anatomical_v42(body_meshes, garment, armature, category):
    if category in v9.UPPER_GARMENTS:
        refine_upper_fit_v42(body_meshes, garment, armature, category)
    return _original_copy_weights(body_meshes, garment, armature, category)


previous.validate_upper_fit_v41 = validate_upper_fit_v42
legacy.copy_weights = copy_weights_anatomical_v42

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
