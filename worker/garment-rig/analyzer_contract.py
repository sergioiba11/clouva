"""Pure evidence, state and readiness contract for CLOUVA Avatar Analyzer V3.2.

This module deliberately has no Blender dependency so scoring and state rules can
be exercised in CI without inventing geometry or relaxing technical gates.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Iterable

ANALYZER_VERSION = "clouva-avatar-analyzer-v3.2"

VERIFIED_STATES = {"verified", "verified_geometry_fallback", "manually_corrected"}
BLOCKING_STATES = {
    "low_confidence", "insufficient_views", "no_visual_evidence",
    "technical_mismatch", "topology_invalid", "unsupported",
}

FACE_REQUIRED = [
    "eye_l_inner", "eye_l_outer", "eye_r_inner", "eye_r_outer",
    "nose_tip", "nose_base", "mouth_corner_l", "mouth_corner_r",
    "upper_lip_center", "lower_lip_center", "chin", "ear_l_center", "ear_r_center",
]
FINGERS = ("thumb", "index", "middle", "ring", "pinky")
HAND_REQUIRED = {
    side: [
        f"wrist_{suffix}",
        *[
            f"{finger}_{joint}_{suffix}"
            for finger in FINGERS for joint in ("01", "02", "03", "tip")
        ],
    ]
    for side, suffix in (("left", "l"), ("right", "r"))
}
CRITICAL_BODY = [
    "pelvis", "neck", "head",
    "shoulder_l", "shoulder_r", "elbow_l", "elbow_r", "wrist_l", "wrist_r",
    "hip_l", "hip_r", "knee_l", "knee_r", "ankle_l", "ankle_r",
]

TECHNICAL_REASONS = {
    "LANDMARK_REGION_BVH_MISS", "LANDMARK_WRONG_REGION",
    "LANDMARK_SILHOUETTE_MISS", "LANDMARK_OBJECT_ID_MISMATCH",
    "LANDMARK_DEPTH_INCONSISTENT", "LANDMARK_TECHNICAL_PASS_MISMATCH",
    "TECHNICAL_EVIDENCE_GATE_FAILED", "TRIANGULATED_POINT_WRONG_REGION",
    "TRIANGULATED_POINT_OUTSIDE_GEOMETRY", "DEPTH_EVIDENCE_LOW",
    "REGION_EVIDENCE_LOW",
}
TOPOLOGY_REASONS = {
    "FINGER_SEGMENT_SCALE_INVALID", "FINGER_BRANCH_CONFIDENCE_LOW",
    "FINGER_BRANCH_LABEL_UNCERTAIN", "FINGER_REGION_BVH_UNAVAILABLE",
    "FINGER_CHAINS_CROSS", "GEOMETRIC_FINGER_BRANCH_UNAVAILABLE",
    "FINGER_CENTERLINE_SAMPLING_FAILED", "SOURCE_CHAIN_NOT_VERIFIED",
}


def _float(value, fallback=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def _reasons(record: dict):
    return {str(value) for value in record.get("rejectionReasons") or []}


def classify_landmark_state(record: dict):
    """Return a user-facing evidence state without changing numeric confidence."""
    if record.get("manualCorrectionApproved") or record.get("approvedByUser"):
        return "manually_corrected", "manual", False
    if record.get("accepted"):
        if record.get("geometryFallback"):
            return "verified_geometry_fallback", "geometry", False
        return "verified", "visual_geometry", False

    views = int(record.get("viewsConfirmed") or 0)
    reasons = _reasons(record)
    if not record.get("supported", True):
        return "unsupported", "unsupported", True
    if reasons.intersection(TECHNICAL_REASONS):
        return "technical_mismatch", "projection", True
    if reasons.intersection(TOPOLOGY_REASONS):
        return "topology_invalid", "topology", True
    if not views and not record.get("topologyRecovered") and not record.get("geometryFallback"):
        return "no_visual_evidence", "detector", True
    if views == 1 or "INSUFFICIENT_TECHNICALLY_VALID_VIEWS" in reasons:
        return "insufficient_views", "triangulation", True
    return "low_confidence", "validation", True


def _placeholder(name: str, region: str):
    return {
        "name": name, "region": region,
        "accepted": False, "verified": False, "display": False,
        "rawConfidence": 0.0, "confidence": 0.0, "finalConfidence": 0.0,
        "viewsConfirmed": 0,
        "state": "no_visual_evidence", "evidenceState": "detector",
        "failureStage": "detector", "failureCode": "DETECTOR_NOT_FOUND",
        "blocking": True, "rejectionReasons": ["NO_VISUAL_EVIDENCE"],
    }


def ensure_required_placeholders(landmarks: dict):
    for name in FACE_REQUIRED:
        landmarks.setdefault(name, _placeholder(name, "head"))
    for side, names in HAND_REQUIRED.items():
        suffix = "l" if side == "left" else "r"
        for name in names:
            landmarks.setdefault(name, _placeholder(name, f"hand_{suffix}"))
    return landmarks


def annotate_landmarks(landmarks: dict):
    ensure_required_placeholders(landmarks)
    for name, record in landmarks.items():
        if not isinstance(record, dict):
            continue
        record.setdefault("name", name)
        explicit_pre_gate = record.get("preGateConfidence")
        measured = [
            record.get("rawFinalConfidence"), record.get("rawConfidence"),
            record.get("finalConfidence"), record.get("confidence"),
            record.get("detectorConfidence"), record.get("topologyConfidence"),
            record.get("geodesicConfidence"), record.get("geometryConfidence"),
            record.get("silhouetteConfidence"), record.get("triangulationConfidence"),
            record.get("symmetryConfidence"),
        ]
        if explicit_pre_gate is not None:
            raw = _float(explicit_pre_gate)
        else:
            raw = max((_float(value) for value in measured if value is not None), default=0.0)
        raw = max(0.0, min(1.0, raw))
        record["rawConfidence"] = raw
        record["rawFinalConfidence"] = raw
        record["finalConfidence"] = raw
        record["confidence"] = raw
        state, evidence, blocking = classify_landmark_state(record)
        record["state"] = state
        record["validationState"] = state
        record["evidenceState"] = evidence
        record["blocking"] = bool(blocking)
        if blocking:
            record.setdefault("failureStage", evidence)
            record.setdefault("failureCode", next(iter(_reasons(record)), state.upper()))
        else:
            record["failureStage"] = None
            record["failureCode"] = None
    return landmarks


def _view_group(view: dict):
    if view.get("region") == "face":
        return "face"
    if view.get("region") == "hand":
        return "leftHand" if view.get("side") == "left" else "rightHand"
    return None


def _failure_group(warning: dict):
    side = warning.get("side")
    if side == "left":
        return "leftHand"
    if side == "right":
        return "rightHand"
    name = str(warning.get("name") or warning.get("landmark") or "")
    if name.endswith("_l") and any(name.startswith(prefix) for prefix in FINGERS):
        return "leftHand"
    if name.endswith("_r") and any(name.startswith(prefix) for prefix in FINGERS):
        return "rightHand"
    if warning.get("region") == "face" or name in FACE_REQUIRED:
        return "face"
    return None


def _landmark_group(name: str):
    if name in FACE_REQUIRED or name.startswith((
        "eye_", "nose_", "mouth_", "upper_lip", "lower_lip", "chin",
        "jaw_", "cheek_", "forehead_", "temple_", "brow_", "ear_",
    )):
        return "face"
    if name.endswith("_l") and name in HAND_REQUIRED["left"]:
        return "leftHand"
    if name.endswith("_r") and name in HAND_REQUIRED["right"]:
        return "rightHand"
    return None


def _failure_stage_code(record: dict, rendered: int, detector_count: int,
                        projected_count: int):
    state = str(record.get("state") or record.get("validationState") or "")
    code = str(record.get("failureCode") or "")
    reasons = _reasons(record)
    if state in VERIFIED_STATES or record.get("accepted"):
        return "verified"
    if rendered == 0:
        return "render_empty"
    if detector_count == 0:
        return "detector_not_found"
    if code == "LANDMARK_REGION_BVH_MISS" or "LANDMARK_REGION_BVH_MISS" in reasons:
        return "region_bvh_miss"
    if code in TECHNICAL_REASONS or reasons.intersection(TECHNICAL_REASONS):
        return "technical_pass_mismatch"
    if code == "RAY_TRIANGULATION_UNSTABLE" or "RAY_TRIANGULATION_UNSTABLE" in reasons:
        return "unstable_triangulation"
    if state == "insufficient_views" or int(record.get("viewsConfirmed") or 0) < 2:
        return "insufficient_views"
    if state == "topology_invalid" or reasons.intersection(TOPOLOGY_REASONS):
        return "topology_invalid"
    if projected_count == 0:
        return "technical_pass_mismatch"
    return "insufficient_views"


def build_landmark_evidence(manifest: dict, detector_output: dict, face: dict, hands: dict):
    """Build stage-by-stage evidence for every required facial and hand landmark."""
    views = manifest.get("views") or []
    detector_views = detector_output.get("views") or []
    detector_by_view = {str(item.get("name") or ""): item for item in detector_views}
    region_reports = {
        "face": face,
        "leftHand": hands.get("left") or {},
        "rightHand": hands.get("right") or {},
    }
    required = [*FACE_REQUIRED, *HAND_REQUIRED["left"], *HAND_REQUIRED["right"]]
    evidence = {}

    for name in required:
        group = _landmark_group(name)
        report = region_reports.get(group) or {}
        record = (report.get("landmarks") or {}).get(name) or _placeholder(
            name, "head" if group == "face" else "hand_l" if group == "leftHand" else "hand_r",
        )
        relevant_views = [view for view in views if _view_group(view) == group]
        rendered = sum(1 for view in relevant_views if bool(view.get("rendered", view.get("path"))))
        detector_candidates = []
        projected_candidates = [
            item for item in (report.get("projectedCandidates") or [])
            if str(item.get("name") or "") == name
        ]
        view_stats = []
        for view in relevant_views:
            detector_view = detector_by_view.get(str(view.get("name") or "")) or {}
            local_detector = [
                item for item in (detector_view.get("candidates") or [])
                if str(item.get("name") or "") == name
            ]
            detector_candidates.extend(local_detector)
            local_projected = [
                item for item in projected_candidates
                if str(item.get("view") or "") == str(view.get("name") or "")
            ]
            view_stats.append({
                "view": view.get("name"),
                "rendered": bool(view.get("rendered", view.get("path"))),
                "proxyVertexCount": int(view.get("proxyVertexCount") or 0),
                "silhouetteCoverage": _float(view.get("silhouetteCoverage")),
                "detectorCandidates": len(local_detector),
                "projectedCandidates": len(local_projected),
                "technicalPassAcceptedCandidates": len(local_projected),
                "framingValid": bool(view.get("framingValid", True)),
                "clippingDetected": bool(view.get("clippingDetected", False)),
                "attempt": view.get("attempt", "final"),
            })
        failure_stage = _failure_stage_code(
            record, rendered, len(detector_candidates), len(projected_candidates),
        )
        item = {
            "name": name,
            "group": group,
            "region": record.get("region"),
            "side": "left" if group == "leftHand" else "right" if group == "rightHand" else None,
            "rendered": rendered,
            "proxyVertexCount": max((entry["proxyVertexCount"] for entry in view_stats), default=0),
            "silhouetteCoverage": (
                sum(entry["silhouetteCoverage"] for entry in view_stats) / max(len(view_stats), 1)
            ),
            "detectorCandidates": len(detector_candidates),
            "projectedCandidates": len(projected_candidates),
            "technicalPassAcceptedCandidates": len(projected_candidates),
            "triangulationInliers": int(record.get("triangulationInliers") or 0),
            "viewsConfirmed": int(record.get("viewsConfirmed") or 0),
            "topologyRecovered": bool(
                record.get("topologyRecovered") or record.get("geometryFallback")
                or "topology" in str(record.get("method") or "")
            ),
            "finalState": record.get("state") or record.get("validationState") or "no_visual_evidence",
            "failureStage": record.get("failureStage") or failure_stage,
            "failureCode": record.get("failureCode") or failure_stage,
            "classifiedFailure": failure_stage,
            "rawConfidence": _float(record.get("rawConfidence", record.get("finalConfidence"))),
            "viewStats": view_stats,
        }
        evidence[name] = item
        if isinstance(record, dict):
            record["evidenceDiagnostics"] = item
    return evidence


def build_detection_coverage(manifest: dict, detector_output: dict, face: dict, hands: dict,
                             attempts: list[dict] | None = None):
    groups = {
        "face": defaultdict(int),
        "leftHand": defaultdict(int),
        "rightHand": defaultdict(int),
    }
    view_details = {key: [] for key in groups}
    detector_lookup = {str(item.get("name")): item for item in detector_output.get("views") or []}

    for view in manifest.get("views") or []:
        group = _view_group(view)
        if not group:
            continue
        detector_view = detector_lookup.get(str(view.get("name"))) or {}
        candidates = detector_view.get("candidates") or []
        rendered = bool(view.get("rendered", view.get("path")))
        if rendered:
            groups[group]["renderedViews"] += 1
        if candidates:
            groups[group]["detectorSuccessfulViews"] += 1
        groups[group]["candidateCount"] += len(candidates)
        view_details[group].append({
            "name": view.get("name"),
            "rendered": rendered,
            "proxyVertexCount": int(view.get("proxyVertexCount") or 0),
            "silhouetteCoverage": _float(view.get("silhouetteCoverage")),
            "detectorCandidates": len(candidates),
            "framingValid": bool(view.get("framingValid", True)),
            "clippingDetected": bool(view.get("clippingDetected", False)),
            "attempt": view.get("attempt", "final"),
        })

    for warning in detector_output.get("errors") or []:
        group = _failure_group(warning)
        if group:
            groups[group]["detectorFailureCount"] += int(warning.get("occurrences") or 1)

    region_reports = {
        "face": face,
        "leftHand": hands.get("left") or {},
        "rightHand": hands.get("right") or {},
    }
    for group, report in region_reports.items():
        projected = report.get("projectedCandidates") or []
        landmarks = report.get("landmarks") or {}
        groups[group]["projectedSuccessfulViews"] = len({
            str(item.get("view")) for item in projected if item.get("view")
        })
        groups[group]["projectedCandidates"] = len(projected)
        groups[group]["triangulatedViews"] = max(
            (int(item.get("viewsConfirmed") or 0) for item in landmarks.values() if isinstance(item, dict)),
            default=0,
        )
        groups[group]["triangulatedLandmarks"] = sum(
            1 for item in landmarks.values()
            if isinstance(item, dict) and item.get("internalJointPosition")
        )
        warnings = report.get("warnings") or []
        groups[group]["projectionFailureCount"] = sum(
            int(item.get("occurrences") or 1)
            for item in warnings
            if str(item.get("code") or "") in {
                "LANDMARK_REGION_BVH_MISS", "LANDMARK_WRONG_REGION",
                "LANDMARK_SILHOUETTE_MISS", "RAY_TRIANGULATION_UNSTABLE",
            }
        )
        groups[group]["technicalMismatchCount"] = sum(
            int(item.get("occurrences") or 1)
            for item in warnings
            if str(item.get("code") or "") in TECHNICAL_REASONS
        )

    output = {}
    for group, counters in groups.items():
        rendered = int(counters.get("renderedViews") or 0)
        detector = int(counters.get("detectorSuccessfulViews") or 0)
        projected = int(counters.get("projectedSuccessfulViews") or 0)
        output[group] = {
            "renderedViews": rendered,
            "detectorSuccessfulViews": detector,
            "projectedSuccessfulViews": projected,
            "triangulatedViews": int(counters.get("triangulatedViews") or 0),
            "candidateCount": int(counters.get("candidateCount") or 0),
            "projectedCandidates": int(counters.get("projectedCandidates") or 0),
            "triangulatedLandmarks": int(counters.get("triangulatedLandmarks") or 0),
            "projectionFailureCount": int(counters.get("projectionFailureCount") or 0),
            "technicalMismatchCount": int(counters.get("technicalMismatchCount") or 0),
            "detectorFailureCount": int(counters.get("detectorFailureCount") or 0),
            "visualCoverage": detector / max(rendered, 1),
            "geometricCoverage": projected / max(detector, 1),
            "views": view_details[group],
        }
    output["landmarks"] = build_landmark_evidence(manifest, detector_output, face, hands)
    if attempts:
        output["attempts"] = attempts
    return output


def _records(landmarks: dict, names: Iterable[str]):
    return [landmarks.get(name) for name in names if isinstance(landmarks.get(name), dict)]


def _score_records(records: list[dict]):
    if not records:
        return 0.0
    weighted = []
    for record in records:
        state = str(record.get("state") or "")
        confidence = _float(record.get("rawConfidence", record.get("finalConfidence")))
        state_factor = 1.0 if state == "verified" else 0.86 if state in VERIFIED_STATES else 0.0
        weighted.append(max(0.0, min(1.0, confidence)) * state_factor)
    return sum(weighted) / len(records)


def _coverage_score(coverage: dict):
    values = []
    for key in ("face", "leftHand", "rightHand"):
        item = coverage.get(key) or {}
        values.append(
            _float(item.get("visualCoverage")) * 0.55
            + _float(item.get("geometricCoverage")) * 0.45
        )
    return sum(values) / max(len(values), 1)


def calculate_rig_readiness(body_report: dict, face: dict, hands: dict, landmarks: dict,
                            coverage: dict, orientation: dict):
    body_score = max(0.0, min(1.0, _float(body_report.get("humanoidConfidence"))))
    face_score = _score_records(_records(landmarks, FACE_REQUIRED))
    left_score = _score_records(_records(landmarks, HAND_REQUIRED["left"]))
    right_score = _score_records(_records(landmarks, HAND_REQUIRED["right"]))
    technical_score = _coverage_score(coverage)
    weighted = (
        body_score * 0.45
        + left_score * 0.175
        + right_score * 0.175
        + face_score * 0.10
        + technical_score * 0.10
    )

    gates = []
    orientation_confidence = _float(orientation.get("orientationConfidence", orientation.get("confidence")))
    if orientation.get("requiresOrientationReview") or orientation_confidence < 0.62:
        gates.append("ORIENTATION_NEEDS_REVIEW")
    missing_body = [
        name for name in CRITICAL_BODY
        if not isinstance(landmarks.get(name), dict) or not landmarks[name].get("accepted", False)
    ]
    if missing_body:
        gates.append("CRITICAL_BODY_LANDMARKS_MISSING")
    if int((coverage.get("leftHand") or {}).get("detectorSuccessfulViews") or 0) == 0:
        gates.append("LEFT_HAND_NO_VISUAL_EVIDENCE")
    if int((coverage.get("rightHand") or {}).get("detectorSuccessfulViews") or 0) == 0:
        gates.append("RIGHT_HAND_NO_VISUAL_EVIDENCE")
    for key in ("face", "leftHand", "rightHand"):
        item = coverage.get(key) or {}
        if int(item.get("technicalMismatchCount") or 0) > 0 and int(item.get("projectedSuccessfulViews") or 0) < 2:
            gates.append(f"{key.upper()}_TECHNICAL_MISMATCH")
    if body_report.get("status") in {"invalid", "needs_review"}:
        gates.append("BODY_ANALYSIS_NOT_APPROVED")
    if face.get("status") in {"invalid", "needs_review"}:
        gates.append("FACE_ANALYSIS_NOT_APPROVED")
    if (hands.get("left") or {}).get("status") in {"invalid", "needs_review"}:
        gates.append("LEFT_HAND_ANALYSIS_NOT_APPROVED")
    if (hands.get("right") or {}).get("status") in {"invalid", "needs_review"}:
        gates.append("RIGHT_HAND_ANALYSIS_NOT_APPROVED")

    gates = list(dict.fromkeys(gates))
    approved = not gates and weighted >= 0.82
    status = "valid" if approved else "needs_review"
    return {
        "score": max(0.0, min(1.0, weighted)),
        "approved": approved,
        "status": status,
        "gates": gates,
        "components": {
            "body": body_score,
            "leftHand": left_score,
            "rightHand": right_score,
            "face": face_score,
            "technicalCoverage": technical_score,
        },
    }


def landmark_metrics(landmarks: dict):
    values = [value for value in landmarks.values() if isinstance(value, dict)]
    states = Counter(str(item.get("state") or "unknown") for item in values)
    return {
        "totalLandmarkRecords": len(values),
        "verifiedSurfaceLandmarkCount": sum(
            1 for item in values if item.get("display", False) and item.get("state") in VERIFIED_STATES
        ),
        "internalJointCount": sum(
            1 for item in values if item.get("landmarkType") in {"internal_joint", "derived_internal"}
        ),
        "rejectedLandmarkCount": sum(1 for item in values if item.get("blocking", False)),
        "hiddenLandmarkCount": sum(1 for item in values if not item.get("display", False)),
        "blockingRejectionCount": sum(1 for item in values if item.get("blocking", False)),
        "verifiedLandmarkCount": sum(1 for item in values if item.get("state") in VERIFIED_STATES),
        "noVisualEvidenceCount": states.get("no_visual_evidence", 0),
        "insufficientViewsCount": states.get("insufficient_views", 0),
        "technicalMismatchCount": states.get("technical_mismatch", 0),
        "topologyInvalidCount": states.get("topology_invalid", 0),
        "stateCounts": dict(states),
    }


def critical_landmarks_verified(landmarks: dict):
    return all(
        isinstance(landmarks.get(name), dict) and landmarks[name].get("accepted", False)
        for name in CRITICAL_BODY
    )
