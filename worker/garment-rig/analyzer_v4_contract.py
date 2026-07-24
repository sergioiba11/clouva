"""Versioned confidence, capability, profile and diagnostic contract for CLOUVA V4.

This module has no Blender dependency. It upgrades the evidence-rich V3.2 result
without mutating the source avatar, calibrates every confidence dimension after
hard gates, separates optional face/finger support from BODY_BASIC, groups common
projection failures and exposes only approved landmarks to Skeleton Planner.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path
from typing import Any, Iterable

_VERSION_CONTRACT = json.loads(
    Path(__file__).with_name("avatar_analyzer_version.json").read_text(encoding="utf-8")
)
ANALYZER_VERSION = str(_VERSION_CONTRACT["analyzerVersion"])
MAP_VERSION = str(_VERSION_CONTRACT["mapVersion"])
CONFIG_VERSION = str(_VERSION_CONTRACT["confidenceConfigVersion"])

RIG_PROFILES = (
    "BODY_BASIC",
    "BODY_FACE",
    "BODY_HANDS_BASIC",
    "FULL_HUMANOID",
    "FULL_BODY_HANDS_FACE",
    "body_only",
    "body_with_hands",
    "full_humanoid",
    "full_humanoid_with_face",
)

LANDMARK_STATES = {
    "verified_visual_geometry",
    "verified_geometry_fallback",
    "verified_single_view_depth",
    "inferred_template_prior",
    "manually_corrected",
    "insufficient_views",
    "projection_mismatch",
    "topology_invalid",
    "unsupported",
    "corrupt_geometry",
}
APPROVED_STATES = {
    "verified_visual_geometry",
    "verified_geometry_fallback",
    "verified_single_view_depth",
    "manually_corrected",
}

PROFILE_ALIASES = {
    "BODY_BASIC": "body_only",
    "BODY_FACE": "full_humanoid_with_face",
    "BODY_HANDS_BASIC": "body_with_hands",
    "FULL_HUMANOID": "full_humanoid",
    "FULL_BODY_HANDS_FACE": "full_humanoid_with_face",
}

DEFAULT_CONFIG: dict[str, Any] = {
    "version": CONFIG_VERSION,
    "minimum_views": {"body": 2, "face": 2, "hand": 2},
    "confidence": {
        "verified": 0.62,
        "fallback": 0.58,
        "manual": 0.70,
        "region": 0.48,
        "topology": 0.50,
        "symmetry": 0.52,
    },
    "right_shoulder": {
        "maximum_arm_length_ratio_error": 0.28,
        "maximum_candidate_displacement_height_ratio": 0.085,
        "maximum_anatomical_error": 0.46,
        "corridor_distance_multiplier": 1.55,
    },
    "camera": {
        "maximum_round_trip_error_pixels": 2.5,
        "minimum_matrix_determinant": 1e-9,
    },
    "render": {
        "body_resolution": 512,
        "face_crop_resolution": 384,
        "hand_crop_resolution": 320,
        "technical_resolution": 192,
    },
}

BODY_REQUIRED = (
    "pelvis", "spine_01", "spine_02", "chest", "neck", "head",
    "shoulder_l", "shoulder_r", "elbow_l", "elbow_r", "wrist_l", "wrist_r",
    "hip_l", "hip_r", "knee_l", "knee_r", "ankle_l", "ankle_r",
    "foot_l", "foot_r",
)
FACE_BASIC_REQUIRED = ("jaw", "eye_l", "eye_r")
FACE_SURFACE_ALIASES = {
    "jaw": ("jaw_center", "chin", "jaw_l", "jaw_r"),
    "eye_l": ("eye_l_center", "eye_l_inner", "eye_l_outer"),
    "eye_r": ("eye_r_center", "eye_r_inner", "eye_r_outer"),
}
FINGERS = ("thumb", "index", "middle", "ring", "pinky")

TECHNICAL_REASONS = {
    "CAMERA_PROJECTION_INVALID",
    "LANDMARK_REGION_BVH_MISS",
    "LANDMARK_WRONG_REGION",
    "LANDMARK_SILHOUETTE_MISS",
    "LANDMARK_OBJECT_ID_MISMATCH",
    "LANDMARK_DEPTH_INCONSISTENT",
    "LANDMARK_TECHNICAL_PASS_MISMATCH",
    "TECHNICAL_EVIDENCE_GATE_FAILED",
    "TRIANGULATED_POINT_WRONG_REGION",
    "TRIANGULATED_POINT_OUTSIDE_GEOMETRY",
    "RAY_DID_NOT_HIT_EXPECTED_ANATOMICAL_REGION",
}
TOPOLOGY_REASONS = {
    "HAND_TOPOLOGY_LIMITED",
    "GEOMETRIC_FINGER_BRANCH_UNAVAILABLE",
    "FINGER_BRANCH_CONFIDENCE_LOW",
    "FINGER_BRANCH_LABEL_UNCERTAIN",
    "FINGER_REGION_BVH_UNAVAILABLE",
    "FINGER_CHAINS_CROSS",
    "FINGER_CENTERLINE_SAMPLING_FAILED",
    "SOURCE_CHAIN_NOT_VERIFIED",
}
PROJECTION_CODES = {
    "LANDMARK_REGION_BVH_MISS",
    "LANDMARK_WRONG_REGION",
    "LANDMARK_SILHOUETTE_MISS",
    "LANDMARK_OBJECT_ID_MISMATCH",
    "LANDMARK_DEPTH_INCONSISTENT",
    "LANDMARK_TECHNICAL_PASS_MISMATCH",
    "TECHNICAL_EVIDENCE_GATE_FAILED",
    "TRIANGULATED_POINT_WRONG_REGION",
    "TRIANGULATED_POINT_OUTSIDE_GEOMETRY",
    "RAY_DID_NOT_HIT_EXPECTED_ANATOMICAL_REGION",
    "RAY DID NOT HIT EXPECTED ANATOMICAL REGION",
}

JOINT_CORRIDORS = {
    "shoulder_l": ("torso", "clavicle_l", "upper_arm_l"),
    "shoulder_r": ("torso", "clavicle_r", "upper_arm_r"),
    "hip_l": ("pelvis", "thigh_l"),
    "hip_r": ("pelvis", "thigh_r"),
    "wrist_l": ("forearm_l", "hand_l"),
    "wrist_r": ("forearm_r", "hand_r"),
    "ankle_l": ("calf_l", "foot_l"),
    "ankle_r": ("calf_r", "foot_r"),
}


def _float(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    return result if math.isfinite(result) else float(fallback)


def _clamp(value: Any) -> float:
    return max(0.0, min(1.0, _float(value)))


def _reasons(record: dict[str, Any]) -> set[str]:
    values = record.get("rejectionReasons") or record.get("rejection_reasons") or []
    return {str(value).strip().upper().replace(" ", "_") for value in values}


def _position(record: Any) -> list[float] | None:
    if not isinstance(record, dict):
        return None
    value = record.get("internalJointPosition") or record.get("position")
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    result = [_float(component, float("nan")) for component in value]
    return result if all(math.isfinite(component) for component in result) else None


def _distance(first: list[float], second: list[float]) -> float:
    return math.sqrt(sum((first[index] - second[index]) ** 2 for index in range(3)))


def _vector(first: list[float], second: list[float]) -> list[float]:
    return [second[index] - first[index] for index in range(3)]


def _norm(value: list[float]) -> float:
    return math.sqrt(sum(component * component for component in value))


def _angle(first: list[float], second: list[float]) -> float:
    first_norm = _norm(first)
    second_norm = _norm(second)
    if first_norm <= 1e-9 or second_norm <= 1e-9:
        return math.pi
    cosine = sum(first[index] * second[index] for index in range(3)) / (first_norm * second_norm)
    return math.acos(max(-1.0, min(1.0, cosine)))


def _region_for_landmark(name: str) -> str:
    if name.startswith(("eye_", "nose_", "mouth_", "jaw", "chin", "ear_", "brow_")):
        return "face"
    if any(name.startswith(f"{finger}_") for finger in FINGERS):
        return "hand"
    if name.startswith(("wrist_", "hand_")):
        return "hand"
    return "body"


def _confidence(record: dict[str, Any], *names: str, default: float = 0.0) -> float:
    for name in names:
        if record.get(name) is not None:
            return _clamp(record.get(name))
    return _clamp(default)


def _observations(record: dict[str, Any]) -> list[dict[str, Any]]:
    values = record.get("observations") or record.get("evidence") or []
    return [item for item in values if isinstance(item, dict)]


def _observation_stats(record: dict[str, Any]) -> tuple[int, int, bool, bool]:
    observations = _observations(record)
    valid = [
        item for item in observations
        if item.get("accepted_or_rejected", item.get("accepted", False)) in (True, "accepted")
        and item.get("ray_hit", item.get("rayHit", True))
    ]
    views = int(record.get("viewsConfirmed") or record.get("views") or len({item.get("camera_id") for item in valid if item.get("camera_id")}))
    inliers = int(record.get("triangulationInliers") or record.get("inliers") or len(valid))
    any_ray_hit = bool(record.get("rayHit", record.get("ray_hit", False))) or any(
        bool(item.get("ray_hit", item.get("rayHit", False))) for item in observations
    )
    has_visual = bool(observations) or views > 0 or record.get("detectorConfidence") is not None
    return views, inliers, any_ray_hit, has_visual


def calibrate_landmark(
    name: str,
    source: dict[str, Any],
    topology_capabilities: dict[str, Any],
    invalid_cameras: set[str] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Apply all evidence gates before exposing a final confidence or state."""
    config = config or DEFAULT_CONFIG
    record = deepcopy(source)
    record["name"] = name
    region = _region_for_landmark(name)
    reasons = _reasons(record)
    observations = _observations(record)
    invalid_cameras = invalid_cameras or set()
    observations_from_invalid_camera = {
        str(item.get("camera_id") or item.get("cameraId") or item.get("view") or "")
        for item in observations
    }.intersection(invalid_cameras)
    if observations_from_invalid_camera:
        reasons.add("CAMERA_PROJECTION_INVALID")
        record["invalidCameraEvidence"] = sorted(observations_from_invalid_camera)

    views, inliers, any_ray_hit, has_visual = _observation_stats(record)
    detector = _confidence(record, "detectorConfidence", "detectionConfidence", "rawConfidence")
    visual = _confidence(record, "visualConfidence", "silhouetteConfidence", default=detector)
    triangulation = _confidence(record, "triangulationConfidence", default=record.get("finalConfidence", 0.0))
    region_confidence = _confidence(record, "regionConfidence", "geometryConfidence", default=record.get("rawConfidence", 0.0))
    topology = _confidence(record, "topologyConfidence", "geodesicConfidence", default=1.0)
    symmetry = _confidence(record, "symmetryConfidence", default=0.0)
    geometry = _confidence(record, "geometryConfidence", "regionConfidence", default=record.get("rawConfidence", 0.0))
    semantic = _confidence(
        record,
        "semanticConfidence",
        "regionCompatibility",
        default=region_confidence,
    )

    if views == 0:
        visual = 0.0
    if inliers == 0:
        triangulation = 0.0
    if has_visual and not any_ray_hit and not record.get("geometryFallback"):
        reasons.add("NO_RAY_HIT")
    hand_side = "left" if name.endswith("_l") else "right" if name.endswith("_r") else None
    is_finger = any(name.startswith(f"{finger}_") for finger in FINGERS)
    five_fingers_supported = bool(topology_capabilities.get(f"{hand_side}_five_fingers_supported")) if hand_side else True
    if is_finger and not five_fingers_supported:
        topology = 0.0
        reasons.add("HAND_TOPOLOGY_LIMITED")
    if reasons.intersection(TOPOLOGY_REASONS):
        topology = 0.0

    manual = bool(record.get("manualCorrectionApproved") or record.get("approvedByUser") or record.get("manual_verified"))
    fallback = bool(record.get("geometryFallback") or record.get("symmetryFallback") or record.get("verifiedWithFallback"))
    technical_invalid = bool(reasons.intersection(TECHNICAL_REASONS) or "NO_RAY_HIT" in reasons)
    minimum_views = int(config["minimum_views"].get(region, 2))
    visual_gate = views >= minimum_views and inliers >= minimum_views and any_ray_hit
    single_view_depth = bool(
        views == 1
        and inliers >= 1
        and any_ray_hit
        and int(record.get("triangleId", record.get("surfaceTriangle", -1)) or -1) >= 0
        and record.get("barycentricCoordinates")
        and region_confidence >= config["confidence"]["region"]
        and geometry >= config["confidence"]["fallback"]
    )
    hand_mode = (
        topology_capabilities.get(f"{hand_side}_hand_mode")
        if hand_side else None
    )
    corrupt = bool(
        "CORRUPT_GEOMETRY" in reasons
        or hand_mode == "unsupported_or_corrupt"
        or record.get("corruptGeometry")
    )
    topology_invalid = bool(reasons.intersection(TOPOLOGY_REASONS))

    if manual:
        state = "manually_corrected"
        final = max(config["confidence"]["manual"], geometry, region_confidence)
        evidence_method = "manual"
    elif corrupt:
        state = "corrupt_geometry"
        final = 0.0
        evidence_method = "geometry"
    elif is_finger and not five_fingers_supported:
        state = "unsupported" if hand_mode == "simplified_mitten" else "topology_invalid"
        final = 0.0
        evidence_method = "topology"
    elif topology_invalid and not fallback:
        state = "topology_invalid"
        final = 0.0
        evidence_method = "topology"
    elif technical_invalid and not fallback:
        state = "projection_mismatch"
        final = 0.0
        evidence_method = "projection"
    elif fallback and geometry >= config["confidence"]["fallback"] and topology > 0.0:
        state = "verified_geometry_fallback"
        components = [geometry, region_confidence, topology, semantic]
        if symmetry > 0.0:
            components.append(symmetry)
        final = sum(components) / len(components)
        evidence_method = str(record.get("verificationMethod") or "geometry_fallback")
    elif single_view_depth:
        state = "verified_single_view_depth"
        components = (detector, visual, region_confidence, topology, geometry, semantic)
        final = sum(components) / len(components)
        evidence_method = "single_view_exact_depth"
    elif visual_gate and topology > 0.0 and region_confidence >= config["confidence"]["region"]:
        state = "verified_visual_geometry"
        components = (detector, visual, triangulation, region_confidence, topology, geometry, semantic)
        final = sum(components) / len(components)
        evidence_method = "visual_geometry"
    elif views == 0 and record.get("templatePrior"):
        state = "inferred_template_prior"
        final = min(0.49, (geometry + semantic) * 0.5)
        evidence_method = "template_prior"
    else:
        state = "insufficient_views"
        components = (detector, visual, triangulation, region_confidence, topology, geometry, semantic)
        final = min(sum(components) / len(components), 0.59)
        evidence_method = "insufficient_views"

    final = _clamp(final)
    if not manual and final >= 1.0:
        final = 0.99
    record.update({
        "detection_confidence": detector,
        "visual_confidence": visual,
        "triangulation_confidence": triangulation,
        "region_confidence": region_confidence,
        "topology_confidence": topology,
        "geometry_confidence": geometry,
        "semantic_confidence": semantic,
        "symmetry_confidence": symmetry,
        "final_confidence": final,
        "finalConfidence": final,
        "confidence": final,
        "views": views,
        "viewsConfirmed": views,
        "inliers": inliers,
        "triangulationInliers": inliers,
        "state": state,
        "validationState": state,
        "evidenceState": evidence_method,
        "accepted": state in APPROVED_STATES,
        "verified": state in APPROVED_STATES,
        "blocking": state not in APPROVED_STATES,
        "manual_verified": manual,
        "evidenceType": evidence_method,
        "rejectionReasons": sorted(reasons),
        "confidenceGateVersion": CONFIG_VERSION,
    })
    return record


def _branch_count(report: Any) -> int:
    maximum = 0
    stack = [report]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            for key, child in value.items():
                normalized = str(key).lower()
                if normalized in {
                    "branchcount", "detectedbranchcount", "geodesicbranchcount",
                    "validbranchcount", "verifiedchains", "fingerchains",
                }:
                    if isinstance(child, (int, float)):
                        maximum = max(maximum, int(child))
                    elif isinstance(child, (list, tuple, dict)):
                        maximum = max(maximum, len(child))
                elif normalized in {"branches", "branchassignment", "metrics"} and isinstance(child, dict):
                    named = [name for name in child if str(name).lower() in FINGERS]
                    maximum = max(maximum, len(named))
                stack.append(child)
        elif isinstance(value, (list, tuple)):
            stack.extend(value)
    return maximum


def infer_topology_capabilities(analysis: dict[str, Any]) -> dict[str, Any]:
    diagnostics = analysis.get("diagnostics") if isinstance(analysis.get("diagnostics"), dict) else {}
    hands = diagnostics.get("hands") if isinstance(diagnostics.get("hands"), dict) else {}
    segmentation = analysis.get("segmentation") if isinstance(analysis.get("segmentation"), dict) else {}
    regions = segmentation.get("regions") if isinstance(segmentation.get("regions"), dict) else {}
    result: dict[str, Any] = {
        "body_supported": bool(analysis.get("isHumanoid", True)) and _float(analysis.get("humanoidConfidence"), 0.0) >= 0.40,
        "face_surface_supported": int((regions.get("head") or {}).get("vertexCount") or 0) >= 4,
        "facial_rig_supported": False,
    }
    for side, suffix in (("left", "l"), ("right", "r")):
        report = hands.get(side) if isinstance(hands.get(side), dict) else {}
        count = _branch_count(report)
        hand_vertices = int((regions.get(f"hand_{suffix}") or {}).get("vertexCount") or 0)
        topology = report.get("topology") if isinstance(report.get("topology"), dict) else {}
        hand_mode = str(
            report.get("handMode")
            or topology.get("handMode")
            or (topology.get("diagnostics") or {}).get("classification", {}).get("mode")
            or ("five_finger_separated" if count >= 5 else "simplified_mitten" if hand_vertices >= 4 else "unsupported_or_corrupt")
        )
        hand_supported = bool(
            report.get("handBaseReady")
            if report.get("handBaseReady") is not None
            else hand_vertices >= 4 or bool(report.get("landmarks"))
        )
        five_supported = bool(
            report.get("fingerRigReady")
            if report.get("fingerRigReady") is not None
            else hand_supported and count >= 5
        )
        result[f"{side}_hand_supported"] = hand_supported
        result[f"{side}_five_fingers_supported"] = five_supported
        result[f"{side}_detected_finger_branches"] = count
        result[f"{side}_hand_mode"] = hand_mode
        result[f"{side}_finger_rig_mode"] = (
            report.get("fingerRigMode")
            or topology.get("fingerRigMode")
            or ("full" if five_supported else "simplified" if hand_mode == "simplified_mitten" else "unsupported")
        )
        result[f"{side}_hand_status"] = (
            "supported" if five_supported else "unsupported" if hand_mode == "simplified_mitten" else "topology_invalid" if hand_supported else "corrupt_geometry"
        )
    face_landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    face_count = sum(1 for name in face_landmarks if _region_for_landmark(str(name)) == "face")
    result["facial_rig_supported"] = bool(result["face_surface_supported"] and face_count >= 8)
    return result


def _corridor_candidate(record: dict[str, Any], multiplier: float) -> bool:
    threshold = _float(record.get("validationThreshold"))
    distance = _float(record.get("surfaceDistance"), float("inf"))
    surface_region = str(record.get("surfaceRegion") or record.get("region") or "")
    allowed = set(record.get("jointCorridor") or [])
    return bool(threshold > 0.0 and distance <= threshold * multiplier and (not allowed or surface_region in allowed))


def apply_joint_corridors(landmarks: dict[str, dict[str, Any]], config: dict[str, Any] | None = None) -> None:
    config = config or DEFAULT_CONFIG
    multiplier = _float(config["right_shoulder"]["corridor_distance_multiplier"], 1.55)
    for name, corridor in JOINT_CORRIDORS.items():
        record = landmarks.get(name)
        if not isinstance(record, dict):
            continue
        record["jointCorridor"] = list(corridor)
        record["jointCorridorVersion"] = "overlapping-anatomical-zones-v4"
        if _corridor_candidate(record, multiplier):
            reasons = [reason for reason in record.get("rejectionReasons") or [] if reason != "BODY_INTERNAL_JOINT_OUTSIDE_REGION"]
            record["rejectionReasons"] = reasons
            record["geometryFallback"] = True
            record["verificationMethod"] = "geometry_verified"
            record["geometryConfidence"] = max(_confidence(record, "geometryConfidence", "rawConfidence"), 0.62)
            record["regionConfidence"] = max(_confidence(record, "regionConfidence"), 0.62)


def repair_right_shoulder(
    landmarks: dict[str, dict[str, Any]],
    dimensions: dict[str, Any],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = config or DEFAULT_CONFIG
    right = landmarks.get("shoulder_r")
    left = landmarks.get("shoulder_l")
    elbow_r = landmarks.get("elbow_r")
    elbow_l = landmarks.get("elbow_l")
    if not all(isinstance(item, dict) for item in (right, left, elbow_r, elbow_l)):
        return {"attempted": False, "reason": "required_landmarks_missing"}
    if right.get("accepted") and "BODY_INTERNAL_JOINT_OUTSIDE_REGION" not in set(right.get("rejectionReasons") or []):
        return {"attempted": False, "reason": "already_valid"}
    left_position = _position(left)
    right_position = _position(right)
    left_elbow = _position(elbow_l)
    right_elbow = _position(elbow_r)
    pelvis = _position(landmarks.get("pelvis"))
    chest = _position(landmarks.get("chest"))
    neck = _position(landmarks.get("neck"))
    if not all((left_position, left_elbow, right_elbow)):
        return {"attempted": False, "reason": "insufficient_geometry"}
    centers = [item[0] for item in (pelvis, chest, neck) if item]
    center_x = sum(centers) / len(centers) if centers else 0.0
    mirrored = [2.0 * center_x - left_position[0], left_position[1], left_position[2]]
    candidate = mirrored
    if right_position:
        candidate = [right_position[index] * 0.72 + mirrored[index] * 0.28 for index in range(3)]
    height = max(_float(dimensions.get("height"), 1.0), 1e-6)
    displacement = _distance(candidate, right_position) / height if right_position else 0.0
    left_length = _distance(left_position, left_elbow)
    right_length = _distance(candidate, right_elbow)
    length_error = abs(right_length - left_length) / max(left_length, 1e-6)
    clavicle_l = _position(landmarks.get("clavicle_l")) or chest or neck
    clavicle_r = _position(landmarks.get("clavicle_r")) or chest or neck
    left_angle = _angle(_vector(left_position, clavicle_l), _vector(left_position, left_elbow)) if clavicle_l else math.pi / 2
    right_angle = _angle(_vector(candidate, clavicle_r), _vector(candidate, right_elbow)) if clavicle_r else math.pi / 2
    angle_error = abs(right_angle - left_angle) / math.pi
    bounds = dimensions.get("bounds") if isinstance(dimensions.get("bounds"), dict) else {}
    minimum = bounds.get("minimum")
    maximum = bounds.get("maximum")
    inside_bounds = True
    if isinstance(minimum, list) and isinstance(maximum, list) and len(minimum) == len(maximum) == 3:
        margin = height * 0.02
        inside_bounds = all(_float(minimum[index]) - margin <= candidate[index] <= _float(maximum[index]) + margin for index in range(3))
    corridor = _corridor_candidate(right, _float(config["right_shoulder"]["corridor_distance_multiplier"], 1.55))
    anatomical_error = length_error * 0.48 + angle_error * 0.30 + displacement * 0.22
    accepted = bool(
        left.get("accepted")
        and elbow_r.get("accepted")
        and inside_bounds
        and length_error <= _float(config["right_shoulder"]["maximum_arm_length_ratio_error"])
        and displacement <= _float(config["right_shoulder"]["maximum_candidate_displacement_height_ratio"])
        and anatomical_error <= _float(config["right_shoulder"]["maximum_anatomical_error"])
        and (corridor or _float(right.get("surfaceDistance"), 0.0) == 0.0)
    )
    diagnostics = {
        "attempted": True,
        "accepted": accepted,
        "candidate": candidate,
        "mirroredCandidate": mirrored,
        "centerX": center_x,
        "leftArmLength": left_length,
        "rightArmLength": right_length,
        "armLengthRatioError": length_error,
        "clavicleShoulderElbowAngleError": angle_error,
        "candidateDisplacementHeightRatio": displacement,
        "insideBodyBounds": inside_bounds,
        "jointCorridorAccepted": corridor,
        "anatomicalError": anatomical_error,
    }
    right["rightShoulderRepair"] = diagnostics
    if accepted:
        right["roughCandidatePosition"] = right_position
        right["position"] = list(candidate)
        right["internalJointPosition"] = list(candidate)
        right["geometryFallback"] = True
        right["symmetryFallback"] = True
        right["verificationMethod"] = "joint_corridor_with_symmetry_prior"
        right["geometryConfidence"] = max(_confidence(right, "geometryConfidence", "rawConfidence"), 0.68)
        right["regionConfidence"] = max(_confidence(right, "regionConfidence"), 0.60)
        right["symmetryConfidence"] = max(0.0, min(0.95, 1.0 - anatomical_error))
        right["accepted"] = True
        right["verified"] = True
        right["rejectionReasons"] = [
            reason for reason in right.get("rejectionReasons") or []
            if reason != "BODY_INTERNAL_JOINT_OUTSIDE_REGION"
        ]
    else:
        right["manualCorrectionRecommended"] = True
        right["manualCorrectionReason"] = "RIGHT_SHOULDER_ONLY_UNRESOLVED_BODY_POINT"
    return diagnostics


def _warning_landmarks(warning: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("landmark", "name"):
        value = warning.get(key)
        if value:
            values.append(str(value))
    for value in warning.get("landmarks") or warning.get("affectedLandmarks") or []:
        if value:
            values.append(str(value))
    return sorted(set(values))


def group_root_causes(
    warnings: Iterable[dict[str, Any]],
    camera_calibration: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    invalid_views = set((camera_calibration or {}).get("invalid_views") or [])
    for raw in warnings or []:
        if not isinstance(raw, dict):
            continue
        code_raw = str(raw.get("code") or raw.get("failureCode") or "UNKNOWN")
        code = code_raw.strip().upper().replace(" ", "_")
        camera = str(raw.get("camera_id") or raw.get("cameraId") or raw.get("view") or "")
        views = [str(value) for value in raw.get("views") or [] if value]
        if camera:
            views.append(camera)
        if code in PROJECTION_CODES or any(value in invalid_views for value in views):
            root_code = "PROJECTION_FAILURE"
            scope = camera or (views[0] if len(set(views)) == 1 else "MULTI_CAMERA")
            probable = "camera/world matrix mismatch, invalid depth scale or wrong handedness"
            automatic = "invalidated the affected camera evidence and kept other views"
            user_action = "review camera calibration only if targeted reanalysis still fails"
        elif code in TOPOLOGY_REASONS:
            root_code = "HAND_TOPOLOGY_LIMITED"
            scope = str(raw.get("side") or "hand")
            probable = "the palm does not expose enough independent geodesic branches"
            automatic = "disabled unsupported finger chains without inventing landmarks"
            user_action = "use BODY_HANDS_BASIC or provide a mesh with separated fingers"
        elif code == "BODY_INTERNAL_JOINT_OUTSIDE_REGION" and str(raw.get("landmark")) == "shoulder_r":
            root_code = "RIGHT_SHOULDER_CORRIDOR_REPAIR"
            scope = "shoulder_r"
            probable = "the transition joint was validated against a single strict region"
            automatic = "tested torso/clavicle/upper-arm corridor plus bilateral symmetry"
            user_action = "correct only Shoulder Derecha if automatic repair is rejected"
        else:
            root_code = code
            scope = str(raw.get("region") or raw.get("side") or raw.get("failureStage") or "global")
            probable = str(raw.get("possibleCause") or "an analyzer gate rejected the available evidence")
            automatic = str(raw.get("automaticAction") or "kept the landmark out of Skeleton Planner")
            user_action = str(raw.get("requiredAction") or "reanalyze the affected region")
        key = (root_code, scope)
        group = groups.setdefault(key, {
            "code": root_code,
            "scope": scope,
            "affected_landmarks": set(),
            "cameras": set(),
            "occurrences": 0,
            "possible_cause": probable,
            "automatic_action_attempted": automatic,
            "required_user_action": user_action,
            "details": [],
        })
        group["occurrences"] += max(1, int(raw.get("occurrences") or 1))
        group["affected_landmarks"].update(_warning_landmarks(raw))
        group["cameras"].update(views)
        if len(group["details"]) < 20:
            group["details"].append({key: value for key, value in raw.items() if key not in {"message"}})
    result = []
    for (code, scope), value in sorted(groups.items()):
        affected = sorted(value.pop("affected_landmarks"))
        cameras = sorted(value.pop("cameras"))
        stable_id = sha256(f"{code}:{scope}".encode("utf-8")).hexdigest()[:12]
        result.append({
            "id": stable_id,
            **value,
            "affected_landmarks": affected,
            "affected_landmark_count": max(len(affected), value["occurrences"] if code == "PROJECTION_FAILURE" else len(affected)),
            "cameras": cameras,
            "summary": f"1 causa raíz / {max(len(affected), value['occurrences'])} landmarks afectados",
        })
    return result


def _approved(landmarks: dict[str, dict[str, Any]], name: str) -> bool:
    return isinstance(landmarks.get(name), dict) and landmarks[name].get("state") in APPROVED_STATES


def _alias_approved(landmarks: dict[str, dict[str, Any]], alias: str) -> bool:
    return any(_approved(landmarks, name) for name in FACE_SURFACE_ALIASES.get(alias, (alias,)))


def compute_rig_profiles(
    landmarks: dict[str, dict[str, Any]],
    capabilities: dict[str, Any],
) -> tuple[list[str], dict[str, Any]]:
    body_missing = [name for name in BODY_REQUIRED if not _approved(landmarks, name)]
    body_ok = bool(capabilities.get("body_supported")) and not body_missing
    face_missing = [name for name in FACE_BASIC_REQUIRED if not _alias_approved(landmarks, name)]
    face_ok = bool(body_ok and capabilities.get("facial_rig_supported") and not face_missing)
    hand_missing = [name for name in ("wrist_l", "wrist_r") if not _approved(landmarks, name)]
    hand_basic_ok = bool(
        body_ok
        and capabilities.get("left_hand_supported")
        and capabilities.get("right_hand_supported")
        and not hand_missing
    )
    finger_missing = [
        f"{finger}_{joint}_{suffix}"
        for suffix in ("l", "r")
        for finger in FINGERS
        for joint in ("01", "02", "03", "tip")
        if not _approved(landmarks, f"{finger}_{joint}_{suffix}")
    ]
    full_ok = bool(
        face_ok and hand_basic_ok
        and capabilities.get("left_five_fingers_supported")
        and capabilities.get("right_five_fingers_supported")
        and not finger_missing
    )
    full_humanoid_ok = bool(
        body_ok and hand_basic_ok
        and capabilities.get("left_five_fingers_supported")
        and capabilities.get("right_five_fingers_supported")
        and not finger_missing
    )
    profiles = {
        "BODY_BASIC": {"supported": body_ok, "missing": body_missing},
        "BODY_FACE": {"supported": face_ok, "missing": [*body_missing, *face_missing]},
        "BODY_HANDS_BASIC": {"supported": hand_basic_ok, "missing": [*body_missing, *hand_missing]},
        "FULL_HUMANOID": {"supported": full_humanoid_ok, "missing": [*body_missing, *hand_missing, *finger_missing]},
        "FULL_BODY_HANDS_FACE": {"supported": full_ok, "missing": [*body_missing, *face_missing, *hand_missing, *finger_missing]},
        "body_only": {"supported": body_ok, "missing": body_missing},
        "body_with_hands": {"supported": hand_basic_ok, "missing": [*body_missing, *hand_missing]},
        "full_humanoid": {"supported": full_humanoid_ok, "missing": [*body_missing, *hand_missing, *finger_missing]},
        "full_humanoid_with_face": {"supported": full_ok, "missing": [*body_missing, *face_missing, *hand_missing, *finger_missing]},
    }
    supported = [name for name in RIG_PROFILES if profiles[name]["supported"]]
    return supported, profiles


def build_targeted_reanalysis_plan(target: str, landmark: str | None = None) -> dict[str, Any]:
    mapping = {
        "reanalyze_face": {"regions": ["face"], "cameras": ["face_front", "face_left_30", "face_right_30", "face_left_profile", "face_right_profile"]},
        "reanalyze_left_hand": {"regions": ["hand_l"], "cameras": ["hand_l_dorsal", "hand_l_palmar", "hand_l_radial", "hand_l_ulnar", "hand_l_oblique"]},
        "reanalyze_right_hand": {"regions": ["hand_r"], "cameras": ["hand_r_dorsal", "hand_r_palmar", "hand_r_radial", "hand_r_ulnar", "hand_r_oblique"]},
        "reanalyze_body": {"regions": ["body"], "cameras": ["body_front", "body_back", "body_left", "body_right", "body_front_left_45", "body_front_right_45", "body_back_left_45", "body_back_right_45"]},
        "reanalyze_right_shoulder": {"regions": ["shoulder_r", "clavicle_r", "upper_arm_r", "bilateral_symmetry"], "landmarks": ["shoulder_r", "clavicle_r", "elbow_r", "shoulder_l", "clavicle_l", "elbow_l"]},
        "rerun_full_pipeline": {"regions": ["body", "face", "hand_l", "hand_r"], "full": True},
    }
    if target == "reanalyze_landmark" and landmark:
        return {"operation": target, "landmarks": [landmark], "regions": [_region_for_landmark(landmark)], "full": False}
    result = deepcopy(mapping.get(target) or {"regions": [], "full": False})
    result["operation"] = target
    result.setdefault("full", False)
    return result


def _stable_fingerprint(payload: dict[str, Any]) -> str:
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return sha256(serialized.encode("utf-8")).hexdigest()


def upgrade_analysis_v4(
    source_analysis: dict[str, Any],
    requested_rig_profile: str = "BODY_BASIC",
    camera_calibration: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = deepcopy(config or DEFAULT_CONFIG)
    if requested_rig_profile not in RIG_PROFILES:
        requested_rig_profile = "BODY_BASIC"
    legacy = deepcopy(source_analysis)
    analysis = deepcopy(source_analysis)
    raw_landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    capabilities = infer_topology_capabilities(analysis)
    apply_joint_corridors(raw_landmarks, config)
    shoulder_repair = repair_right_shoulder(raw_landmarks, analysis.get("dimensions") or {}, config)
    invalid_cameras = set((camera_calibration or {}).get("invalid_views") or [])
    landmarks = {
        name: calibrate_landmark(name, record if isinstance(record, dict) else {}, capabilities, invalid_cameras, config)
        for name, record in sorted(raw_landmarks.items())
    }
    analysis["landmarks"] = landmarks
    supported_profiles, profile_diagnostics = compute_rig_profiles(landmarks, capabilities)
    requested_supported = requested_rig_profile in supported_profiles
    warnings = [item for item in analysis.get("warnings") or [] if isinstance(item, dict)]
    if shoulder_repair.get("attempted"):
        warnings.append({
            "code": "RIGHT_SHOULDER_CORRIDOR_REPAIR",
            "landmark": "shoulder_r",
            "attempt": shoulder_repair,
            "blocking": not shoulder_repair.get("accepted", False),
        })
    for side in ("left", "right"):
        if capabilities.get(f"{side}_hand_supported") and not capabilities.get(f"{side}_five_fingers_supported"):
            hand_mode = capabilities.get(f"{side}_hand_mode")
            warnings.append({
                "code": "HAND_FINGER_RIG_UNSUPPORTED" if hand_mode == "simplified_mitten" else "HAND_TOPOLOGY_LIMITED",
                "side": side,
                "handMode": hand_mode,
                "detectedBranches": capabilities.get(f"{side}_detected_finger_branches", 0),
                "message": "La mano no contiene cinco ramas geométricas separadas; se habilita mano simplificada sin inventar dedos.",
                "blocking": requested_rig_profile in {"FULL_HUMANOID", "FULL_BODY_HANDS_FACE", "full_humanoid", "full_humanoid_with_face"},
            })
    root_causes = group_root_causes(warnings, camera_calibration)
    requested_missing = profile_diagnostics[requested_rig_profile]["missing"]
    technical_failure = bool((camera_calibration or {}).get("all_views_invalid"))
    if technical_failure:
        overall = "technical_failure"
    elif requested_supported:
        fallback_count = sum(1 for item in landmarks.values() if item.get("state") == "verified_geometry_fallback")
        overall = "approved_with_fallbacks" if fallback_count else "approved"
    elif requested_missing:
        overall = "needs_review" if requested_rig_profile in {"BODY_BASIC", "body_only"} else "incompatible_with_requested_profile"
    else:
        overall = "incompatible_with_requested_profile"
    approved_landmarks = {
        name: record for name, record in landmarks.items() if record.get("state") in APPROVED_STATES
    }
    fallbacks = [
        {"landmark": name, "method": record.get("verificationMethod") or record.get("evidenceState")}
        for name, record in landmarks.items() if record.get("state") == "verified_geometry_fallback"
    ]
    manual = [
        {"landmark": name, "position": _position(record), "note": record.get("note")}
        for name, record in landmarks.items() if record.get("state") == "manually_corrected"
    ]
    blocking_reasons = [
        {"landmark": name, "state": landmarks.get(name, {}).get("state"), "reasons": landmarks.get(name, {}).get("rejectionReasons") or []}
        for name in requested_missing
    ]
    if overall in {"approved", "approved_with_fallbacks"}:
        next_action = f"create_{requested_rig_profile.lower()}"
    elif requested_rig_profile != "BODY_BASIC" and "BODY_BASIC" in supported_profiles:
        next_action = "continue_with_BODY_BASIC_or_reanalyze_optional_modules"
    elif requested_missing == ["shoulder_r"] or ("shoulder_r" in requested_missing and len(requested_missing) <= 2):
        next_action = "manually_correct_right_shoulder_only"
    else:
        next_action = "reanalyze_blocking_regions"
    stable_subset = {
        "source_sha256": (analysis.get("source") or {}).get("sha256"),
        "requested_profile": requested_rig_profile,
        "capabilities": capabilities,
        "profiles": profile_diagnostics,
        "landmarks": {
            name: {
                "state": record.get("state"),
                "final_confidence": record.get("final_confidence"),
                "position": _position(record),
                "reasons": record.get("rejectionReasons") or [],
            }
            for name, record in landmarks.items()
        },
        "root_causes": [{key: value for key, value in item.items() if key != "details"} for item in root_causes],
    }
    fingerprint = _stable_fingerprint(stable_subset)
    cache_key = _stable_fingerprint({
        "source_sha256": (analysis.get("source") or {}).get("sha256"),
        "analyzer_version": ANALYZER_VERSION,
        "map_version": MAP_VERSION,
        "confidence_config_version": CONFIG_VERSION,
    })
    body_scores = [
        _float(landmarks[name].get("final_confidence")) for name in BODY_REQUIRED if name in landmarks
    ]
    body_score = sum(body_scores) / len(body_scores) if body_scores else 0.0
    face_names = [
        name for name in landmarks
        if _region_for_landmark(name) == "face"
    ]
    face_scores = [_float(landmarks[name].get("final_confidence")) for name in face_names]
    face_score = sum(face_scores) / len(face_scores) if face_scores else 0.0
    body_ready = bool(profile_diagnostics["body_only"]["supported"])
    face_ready = bool(
        capabilities.get("facial_rig_supported")
        and all(_alias_approved(landmarks, name) for name in FACE_BASIC_REQUIRED)
    )
    left_hand_base_ready = bool(
        capabilities.get("left_hand_supported") and _approved(landmarks, "wrist_l")
    )
    right_hand_base_ready = bool(
        capabilities.get("right_hand_supported") and _approved(landmarks, "wrist_r")
    )
    left_finger_names = [
        f"{finger}_{joint}_l"
        for finger in FINGERS for joint in ("01", "02", "03", "tip")
    ]
    right_finger_names = [
        f"{finger}_{joint}_r"
        for finger in FINGERS for joint in ("01", "02", "03", "tip")
    ]
    left_finger_ready = bool(
        capabilities.get("left_five_fingers_supported")
        and all(_approved(landmarks, name) for name in left_finger_names)
    )
    right_finger_ready = bool(
        capabilities.get("right_five_fingers_supported")
        and all(_approved(landmarks, name) for name in right_finger_names)
    )
    full_humanoid_ready = bool(body_ready and left_finger_ready and right_finger_ready)
    requested_profile_key = PROFILE_ALIASES.get(requested_rig_profile, requested_rig_profile)
    analysis.update({
        "version": ANALYZER_VERSION,
        "analyzer_version": "4.1",
        "mapVersion": MAP_VERSION,
        "requested_rig_profile": requested_rig_profile,
        "requested_rig_profile_key": requested_profile_key,
        "supported_rig_profiles": supported_profiles,
        "rig_profiles": profile_diagnostics,
        "overall_status": overall,
        "status": "valid_with_warnings" if overall == "approved_with_fallbacks" else "valid" if overall == "approved" else "needs_review" if overall != "technical_failure" else "failed",
        "regions": {
            "body": analysis.get("bodySubsystems") or {},
            "face": {"status": analysis.get("faceAnalysis")},
            "left_hand": {"status": analysis.get("leftHandAnalysis")},
            "right_hand": {"status": analysis.get("rightHandAnalysis")},
        },
        "camera_calibration": camera_calibration or {},
        "topology_capabilities": capabilities,
        "root_causes": root_causes,
        "fallbacks_used": fallbacks,
        "manual_corrections": manual,
        "blocking_reasons": blocking_reasons,
        "recommended_next_action": next_action,
        "confidence_gate_config": config,
        "right_shoulder_repair": shoulder_repair,
        "skeleton_planner_input": approved_landmarks,
        "skeletonPlanner": {
            "acceptedStates": sorted(APPROVED_STATES),
            "landmarkCount": len(approved_landmarks),
            "inventedLandmarks": 0,
            "requestedRigProfile": requested_rig_profile,
        },
        "diagnostic_fingerprint": fingerprint,
        "analysisCacheKey": cache_key,
        "rigReadinessScore": body_score,
        "rigReadinessApproved": requested_supported,
        "bodyRigScore": body_score,
        "bodyRigReady": body_ready,
        "faceAnalysisScore": face_score,
        "faceAnalysisReady": face_ready,
        "leftHandBaseReady": left_hand_base_ready,
        "rightHandBaseReady": right_hand_base_ready,
        "leftFingerRigReady": left_finger_ready,
        "rightFingerRigReady": right_finger_ready,
        "fullHumanoidRigReady": full_humanoid_ready,
        "unrealExportReady": bool(requested_supported and body_ready),
        "criticalLandmarksVerified": profile_diagnostics["BODY_BASIC"]["supported"],
        "rigReadinessGates": [item["landmark"] for item in blocking_reasons],
        "warnings": warnings,
        "legacy_analyzer": {
            "version": legacy.get("version"),
            "status": legacy.get("status"),
            "rigReadinessScore": legacy.get("rigReadinessScore"),
            "preserved": True,
        },
    })
    return analysis
