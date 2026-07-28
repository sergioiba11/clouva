"""Residual production repairs for CLOUVA Avatar Analyzer V4.1.

This layer runs after the retained V4 contract. It does not mutate the source GLB;
it only normalizes verified hand capabilities and diagnostic state/metric semantics.
"""
from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

FINGERS = ("thumb", "index", "middle", "ring", "pinky")
APPROVED_STATES = {
    "verified_internal_geometry",
    "verified_visual_geometry",
    "verified_geometry_fallback",
    "verified_single_view_depth",
    "manually_corrected",
}
CANONICAL_PROFILES = (
    "BODY_BASIC",
    "BODY_FACE",
    "BODY_HANDS_BASIC",
    "FULL_HUMANOID",
    "FULL_BODY_HANDS_FACE",
)
PROFILE_ALIASES = {
    "body_only": "BODY_BASIC",
    "body_with_hands": "BODY_HANDS_BASIC",
    "full_humanoid": "FULL_HUMANOID",
    "full_humanoid_with_face": "FULL_BODY_HANDS_FACE",
}
LEGACY_PROFILE_ALIASES = {
    "BODY_BASIC": "body_only",
    "BODY_HANDS_BASIC": "body_with_hands",
    "FULL_HUMANOID": "full_humanoid",
    "FULL_BODY_HANDS_FACE": "full_humanoid_with_face",
}

PROJECTION_MISMATCH_REASONS = {
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
LOW_CONFIDENCE_REASONS = {
    "RAY_RESIDUAL_TOO_HIGH",
    "RAY_TRIANGULATION_UNSTABLE",
    "FINAL_CONFIDENCE_LOW",
    "INSUFFICIENT_TECHNICALLY_VALID_VIEWS",
    "DEPTH_EVIDENCE_LOW",
    "REGION_EVIDENCE_LOW",
    "INSUFFICIENT_VISUAL_GEOMETRY_AGREEMENT",
    "VISUAL_GEOMETRY_AGREEMENT_LOW",
}
TOPOLOGY_STATES = {"topology_invalid", "unsupported", "corrupt_geometry"}


def _normalized_token(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", str(value or "").strip().upper()).strip("_")


def _reasons(record: dict[str, Any]) -> set[str]:
    values = record.get("rejectionReasons") or record.get("rejection_reasons") or []
    return {_normalized_token(value) for value in values if value is not None}


def _int_count(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return max(0, int(value))
    if isinstance(value, (list, tuple, set, dict)):
        return len(value)
    return None


def _verified_branch_count(report: Any) -> int:
    """Count only geometric or verified branch/chain evidence."""
    maximum = 0
    stack: list[Any] = [report]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            for key, child in value.items():
                token = _normalized_token(key).lower()
                branch_like = "branch" in token or "chain" in token
                geometric = any(
                    marker in token
                    for marker in ("verified", "valid", "geodesic", "geometry", "geometric")
                )
                explicitly_unverified = any(
                    marker in token
                    for marker in ("visual", "detected", "candidate", "tip", "valley")
                )
                if branch_like and geometric and not explicitly_unverified:
                    count = _int_count(child)
                    if count is not None:
                        maximum = max(maximum, min(5, count))
                stack.append(child)
        elif isinstance(value, (list, tuple)):
            stack.extend(value)
    return maximum


def _hand_reports(analysis: dict[str, Any]) -> dict[str, Any]:
    diagnostics = analysis.get("diagnostics") if isinstance(analysis.get("diagnostics"), dict) else {}
    v4_attempt = diagnostics.get("v4Attempt") if isinstance(diagnostics.get("v4Attempt"), dict) else {}
    v4_hands = v4_attempt.get("hands") if isinstance(v4_attempt.get("hands"), dict) else {}
    legacy_hands = diagnostics.get("hands") if isinstance(diagnostics.get("hands"), dict) else {}
    return {
        side: (
            v4_hands.get(side)
            if isinstance(v4_hands.get(side), dict)
            else legacy_hands.get(side)
            if isinstance(legacy_hands.get(side), dict)
            else {}
        )
        for side in ("left", "right")
    }


def _reported_finger_mode(report: dict[str, Any]) -> str:
    topology = report.get("topology") if isinstance(report.get("topology"), dict) else {}
    return str(report.get("fingerRigMode") or topology.get("fingerRigMode") or "").strip().lower()


def _hand_supported(
    analysis: dict[str, Any],
    capabilities: dict[str, Any],
    report: dict[str, Any],
    side: str,
) -> bool:
    explicit = capabilities.get(f"{side}_hand_supported")
    if explicit is not None:
        return bool(explicit)
    ready = report.get("handBaseReady")
    if ready is not None:
        return bool(ready)
    suffix = "l" if side == "left" else "r"
    segmentation = analysis.get("segmentation") if isinstance(analysis.get("segmentation"), dict) else {}
    regions = segmentation.get("regions") if isinstance(segmentation.get("regions"), dict) else {}
    region = regions.get(f"hand_{suffix}") if isinstance(regions.get(f"hand_{suffix}"), dict) else {}
    return int(region.get("vertexCount") or 0) >= 4 or bool(report.get("landmarks"))


def _derived_finger_mode(hand_supported: bool, branches: int) -> str:
    if not hand_supported:
        return "unsupported"
    if branches >= 5:
        return "full"
    if branches >= 2:
        return "partial"
    return "simplified"


def _derived_hand_mode(derived_mode: str, reported_hand_mode: str) -> str:
    if derived_mode == "full":
        return (
            reported_hand_mode
            if reported_hand_mode in {"five_finger_connected", "five_finger_separated"}
            else "five_finger_connected"
        )
    if derived_mode == "partial":
        return "partial_fingers"
    if derived_mode == "simplified":
        return "simplified_mitten"
    return "unsupported_or_corrupt"


def _normalize_landmark_state(record: dict[str, Any]) -> str:
    state = str(record.get("state") or record.get("validationState") or "").strip().lower()
    reasons = _reasons(record)
    if record.get("accepted") is True or state in APPROVED_STATES:
        return state if state in APPROVED_STATES else (
            "verified_internal_geometry"
            if record.get("evidenceType") == "internal_geometry"
            else "verified_visual_geometry"
        )
    if state in TOPOLOGY_STATES:
        return state
    if reasons.intersection(PROJECTION_MISMATCH_REASONS):
        return "projection_mismatch"
    if state in {"insufficient_views", "no_visual_evidence"}:
        return state
    if state == "projection_mismatch" and reasons and reasons.issubset(LOW_CONFIDENCE_REASONS):
        return "low_confidence"
    if state == "technical_mismatch":
        return "low_confidence" if reasons.intersection(LOW_CONFIDENCE_REASONS) else "manual_review_required"
    if state == "low_confidence" or reasons.intersection(LOW_CONFIDENCE_REASONS):
        return "low_confidence"
    if state == "manual_review_required":
        return state
    views = int(record.get("viewsConfirmed") or record.get("views") or 0)
    return "no_visual_evidence" if views == 0 else "manual_review_required"


def _canonical_metrics(
    landmarks: dict[str, Any],
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    states: dict[str, int] = {}
    verified = 0
    verified_surface = 0
    internal = 0
    hidden = 0
    total = 0
    for record in landmarks.values():
        if not isinstance(record, dict):
            continue
        total += 1
        state = _normalize_landmark_state(record)
        record["state"] = state
        record["validationState"] = state
        states[state] = states.get(state, 0) + 1
        if state in APPROVED_STATES:
            verified += 1
            if record.get("display"):
                verified_surface += 1
        if state == "verified_internal_geometry":
            internal += 1
        if not record.get("display", False):
            hidden += 1
    return {
        **(previous or {}),
        "verifiedLandmarkCount": verified,
        "verifiedSurfaceLandmarkCount": verified_surface,
        "internalJointCount": internal,
        "rejectedLandmarkCount": max(0, total - verified),
        "noVisualEvidenceCount": states.get("no_visual_evidence", 0),
        "insufficientViewsCount": states.get("insufficient_views", 0),
        "lowConfidenceCount": states.get("low_confidence", 0),
        "projectionMismatchCount": states.get("projection_mismatch", 0),
        "technicalMismatchCount": states.get("projection_mismatch", 0),
        "topologyInvalidCount": states.get("topology_invalid", 0),
        "unsupportedCount": states.get("unsupported", 0),
        "manualReviewRequiredCount": states.get("manual_review_required", 0),
        "hiddenLandmarkCount": hidden,
        "landmarkStates": states,
    }


def _approved(landmarks: dict[str, Any], name: str) -> bool:
    record = landmarks.get(name)
    return isinstance(record, dict) and str(record.get("state") or "") in APPROVED_STATES


def _finger_landmarks_ready(landmarks: dict[str, Any], suffix: str) -> bool:
    return all(
        _approved(landmarks, f"{finger}_{joint}_{suffix}")
        for finger in FINGERS
        for joint in ("01", "02", "03", "tip")
    )


def _profile_result(profiles: dict[str, Any], name: str) -> dict[str, Any]:
    value = profiles.get(name)
    return deepcopy(value) if isinstance(value, dict) else {"supported": False, "missing": [name.lower()]}


def _recompute_full_profiles(analysis: dict[str, Any], capabilities: dict[str, Any]) -> None:
    profiles = analysis.get("rig_profiles") if isinstance(analysis.get("rig_profiles"), dict) else {}
    profiles = deepcopy(profiles)
    body_hands = _profile_result(profiles, "BODY_HANDS_BASIC")
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    missing = list(body_hands.get("missing") or [])
    for side, suffix in (("left", "l"), ("right", "r")):
        if not capabilities.get(f"{side}_five_fingers_supported"):
            missing.append(f"{side}_five_finger_topology")
        if not _finger_landmarks_ready(landmarks, suffix):
            missing.append(f"{side}_finger_landmarks")
    full_supported = bool(body_hands.get("supported") and not missing)
    full = {"supported": full_supported, "missing": sorted(set(missing))}
    profiles["FULL_HUMANOID"] = full
    profiles["full_humanoid"] = full
    face = _profile_result(profiles, "BODY_FACE")
    combined = {
        "supported": bool(full_supported and face.get("supported")),
        "missing": sorted(set([*(full.get("missing") or []), *(face.get("missing") or [])])),
    }
    profiles["FULL_BODY_HANDS_FACE"] = combined
    profiles["full_humanoid_with_face"] = combined
    analysis["rig_profiles"] = profiles

    canonical_supported = [
        name
        for name in CANONICAL_PROFILES
        if bool((profiles.get(name) or {}).get("supported"))
    ]
    supported: list[str] = []
    for name in canonical_supported:
        supported.append(name)
        alias = LEGACY_PROFILE_ALIASES.get(name)
        if alias:
            supported.append(alias)
    analysis["supportedRigProfiles"] = canonical_supported
    analysis["supported_rig_profiles"] = supported

    requested = str(
        analysis.get("requestedRigProfile")
        or analysis.get("requested_rig_profile")
        or "BODY_BASIC"
    )
    requested = PROFILE_ALIASES.get(requested, requested)
    requested_result = (
        profiles.get(requested)
        if isinstance(profiles.get(requested), dict)
        else {"supported": False, "missing": []}
    )
    requested_ready = bool(requested_result.get("supported"))
    analysis["requestedProfileReady"] = requested_ready
    analysis["rigReadinessApproved"] = requested_ready
    analysis["requestedProfileBlockingReasons"] = [
        {
            "landmark": name,
            "state": (landmarks.get(name) or {}).get("state"),
            "reasons": (landmarks.get(name) or {}).get("rejectionReasons") or [],
        }
        for name in requested_result.get("missing") or []
    ]
    analysis["blocking_reasons"] = analysis["requestedProfileBlockingReasons"]
    analysis["rigReadinessGates"] = [
        item["landmark"] for item in analysis["requestedProfileBlockingReasons"]
    ]
    if str(analysis.get("overall_status")) != "technical_failure":
        if requested_ready:
            fallback = any(
                isinstance(record, dict) and record.get("state") == "verified_geometry_fallback"
                for record in landmarks.values()
            )
            analysis["overall_status"] = "approved_with_fallbacks" if fallback else "approved"
            analysis["status"] = "valid_with_warnings" if fallback else "valid"
        else:
            analysis["overall_status"] = (
                "needs_review"
                if requested == "BODY_BASIC"
                else "incompatible_with_requested_profile"
            )
            analysis["status"] = "needs_review"


def apply_residual_repairs_v41(source: dict[str, Any]) -> dict[str, Any]:
    """Normalize residual V4.1 production issues in-place and return the analysis."""
    analysis = source
    capabilities = (
        analysis.get("topology_capabilities")
        if isinstance(analysis.get("topology_capabilities"), dict)
        else {}
    )
    capabilities = deepcopy(capabilities)
    reports = _hand_reports(analysis)
    warnings = [item for item in analysis.get("warnings") or [] if isinstance(item, dict)]

    for side, suffix in (("left", "l"), ("right", "r")):
        report = reports[side]
        branches = _verified_branch_count(report)
        hand_supported = _hand_supported(analysis, capabilities, report, side)
        derived_mode = _derived_finger_mode(hand_supported, branches)
        reported_mode = _reported_finger_mode(report)
        reported_hand_mode = str(
            report.get("handMode")
            or (
                (report.get("topology") or {})
                if isinstance(report.get("topology"), dict)
                else {}
            ).get("handMode")
            or capabilities.get(f"{side}_hand_mode")
            or ""
        ).strip().lower()
        derived_hand_mode = _derived_hand_mode(derived_mode, reported_hand_mode)
        conflict = bool(reported_mode and reported_mode != derived_mode)

        capabilities[f"{side}_hand_supported"] = hand_supported
        capabilities[f"{side}_detected_finger_branches"] = branches
        capabilities[f"{side}_verified_finger_branch_count"] = branches
        capabilities[f"{side}_five_fingers_supported"] = bool(hand_supported and branches >= 5)
        capabilities[f"{side}_hand_mode"] = derived_hand_mode
        capabilities[f"{side}_reported_finger_rig_mode"] = reported_mode or None
        capabilities[f"{side}_derived_finger_rig_mode"] = derived_mode
        capabilities[f"{side}_finger_rig_mode"] = derived_mode
        capabilities[f"{side}_finger_rig_mode_conflict"] = conflict
        capabilities[f"{side}_hand_status"] = (
            "topology_five_finger"
            if derived_mode == "full"
            else "hand_base_valid"
            if hand_supported
            else "hand_base_invalid"
        )
        if conflict and not any(
            item.get("code") == "LEGACY_FINGER_RIG_MODE_CONFLICT"
            and item.get("side") == side
            for item in warnings
        ):
            warnings.append({
                "code": "LEGACY_FINGER_RIG_MODE_CONFLICT",
                "side": side,
                "reportedMode": reported_mode,
                "derivedMode": derived_mode,
                "verifiedBranches": branches,
                "blocking": False,
            })

        analysis[f"{side}FingerRigMode"] = derived_mode
        analysis[f"{side}VerifiedFingerBranches"] = branches
        finger_ready = bool(
            derived_mode == "full"
            and _finger_landmarks_ready(
                analysis.get("landmarks")
                if isinstance(analysis.get("landmarks"), dict)
                else {},
                suffix,
            )
        )
        analysis[f"{side}FingerRigReady"] = finger_ready

    analysis["topology_capabilities"] = capabilities
    analysis["warnings"] = warnings
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    analysis["metrics"] = _canonical_metrics(
        landmarks,
        analysis.get("metrics") if isinstance(analysis.get("metrics"), dict) else {},
    )
    _recompute_full_profiles(analysis, capabilities)
    analysis["fullHumanoidRigReady"] = bool(
        analysis.get("bodyRigReady")
        and analysis.get("leftFingerRigReady")
        and analysis.get("rightFingerRigReady")
    )
    analysis.setdefault("diagnostics", {})["v41ResidualRepairs"] = {
        "version": "clouva-avatar-analyzer-v4.1-residuals-1",
        "leftFingerRigMode": analysis.get("leftFingerRigMode"),
        "rightFingerRigMode": analysis.get("rightFingerRigMode"),
        "leftVerifiedFingerBranches": analysis.get("leftVerifiedFingerBranches"),
        "rightVerifiedFingerBranches": analysis.get("rightVerifiedFingerBranches"),
        "metrics": {
            key: analysis["metrics"].get(key)
            for key in (
                "lowConfidenceCount",
                "projectionMismatchCount",
                "technicalMismatchCount",
                "topologyInvalidCount",
            )
        },
    }
    return analysis


__all__ = [
    "LOW_CONFIDENCE_REASONS",
    "PROJECTION_MISMATCH_REASONS",
    "apply_residual_repairs_v41",
]
