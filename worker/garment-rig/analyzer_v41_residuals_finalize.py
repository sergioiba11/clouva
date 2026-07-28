"""Final invariant pass for CLOUVA Avatar Analyzer V4.1 residual repairs.

This module keeps the retained residual layer intact and closes two production
edge cases discovered during the final audit: corrupt hand geometry must always
be unsupported, and unstable ray triangulation is a confidence failure rather
than a missing-view or projection incompatibility failure.
"""
from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

import analyzer_v41_residuals as residuals


_CORRUPT_HAND_MODES = {"unsupported_or_corrupt", "corrupt_geometry", "corrupt"}
_UNSTABLE_CONFIDENCE_REASONS = {"RAY_TRIANGULATION_UNSTABLE"}


def _token(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", str(value or "").strip().upper()).strip("_")


def _reasons(record: dict[str, Any]) -> set[str]:
    values = record.get("rejectionReasons") or record.get("rejection_reasons") or []
    return {_token(value) for value in values if value is not None}


def _hand_reports(analysis: dict[str, Any]) -> dict[str, dict[str, Any]]:
    diagnostics = analysis.get("diagnostics") if isinstance(analysis.get("diagnostics"), dict) else {}
    v4_attempt = diagnostics.get("v4Attempt") if isinstance(diagnostics.get("v4Attempt"), dict) else {}
    v4_hands = v4_attempt.get("hands") if isinstance(v4_attempt.get("hands"), dict) else {}
    legacy_hands = diagnostics.get("hands") if isinstance(diagnostics.get("hands"), dict) else {}
    return {
        side: deepcopy(
            v4_hands.get(side)
            if isinstance(v4_hands.get(side), dict)
            else legacy_hands.get(side)
            if isinstance(legacy_hands.get(side), dict)
            else {}
        )
        for side in ("left", "right")
    }


def _hand_is_corrupt(report: dict[str, Any]) -> bool:
    topology = report.get("topology") if isinstance(report.get("topology"), dict) else {}
    modes = {
        str(report.get("handMode") or "").strip().lower(),
        str(topology.get("handMode") or "").strip().lower(),
        str(report.get("status") or "").strip().lower(),
    }
    return bool(
        report.get("corruptGeometry")
        or topology.get("corruptGeometry")
        or modes.intersection(_CORRUPT_HAND_MODES)
    )


def _normalize_unstable_landmarks(analysis: dict[str, Any]) -> None:
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    for record in landmarks.values():
        if not isinstance(record, dict) or record.get("accepted") is True:
            continue
        reasons = _reasons(record)
        if not reasons.intersection(_UNSTABLE_CONFIDENCE_REASONS):
            continue
        if reasons.intersection(residuals.PROJECTION_MISMATCH_REASONS):
            continue
        record["state"] = "low_confidence"
        record["validationState"] = "low_confidence"
        record["evidenceState"] = "validation"
        record["failureStage"] = "validation"
        record["blocking"] = True


def _recompute_hand_profiles(analysis: dict[str, Any], capabilities: dict[str, Any]) -> None:
    profiles = analysis.get("rig_profiles") if isinstance(analysis.get("rig_profiles"), dict) else {}
    profiles = deepcopy(profiles)
    body = deepcopy(profiles.get("BODY_BASIC") or {"supported": False, "missing": ["body_basic"]})
    missing = list(body.get("missing") or [])
    for side in ("left", "right"):
        if not capabilities.get(f"{side}_hand_supported"):
            missing.append(f"{side}_hand_base")
    hands = {"supported": bool(body.get("supported") and not missing), "missing": sorted(set(missing))}
    profiles["BODY_HANDS_BASIC"] = hands
    profiles["body_with_hands"] = hands
    analysis["rig_profiles"] = profiles
    residuals._recompute_full_profiles(analysis, capabilities)


def apply_residual_repairs_v41(source: dict[str, Any]) -> dict[str, Any]:
    """Apply retained repairs and enforce the final production invariants."""
    analysis = residuals.apply_residual_repairs_v41(source)
    capabilities = analysis.get("topology_capabilities")
    if not isinstance(capabilities, dict):
        capabilities = {}
    capabilities = deepcopy(capabilities)
    reports = _hand_reports(analysis)
    warnings = [item for item in analysis.get("warnings") or [] if isinstance(item, dict)]

    for side in ("left", "right"):
        if not _hand_is_corrupt(reports[side]):
            continue
        capabilities[f"{side}_hand_supported"] = False
        capabilities[f"{side}_five_fingers_supported"] = False
        capabilities[f"{side}_hand_mode"] = "unsupported_or_corrupt"
        capabilities[f"{side}_derived_finger_rig_mode"] = "unsupported"
        capabilities[f"{side}_finger_rig_mode"] = "unsupported"
        capabilities[f"{side}_finger_rig_mode_conflict"] = bool(
            capabilities.get(f"{side}_reported_finger_rig_mode") not in (None, "", "unsupported")
        )
        capabilities[f"{side}_hand_status"] = "hand_base_invalid"
        analysis[f"{side}HandBaseReady"] = False
        analysis[f"{side}FingerRigMode"] = "unsupported"
        analysis[f"{side}FingerRigReady"] = False
        if not any(item.get("code") == "HAND_GEOMETRY_UNSUPPORTED" and item.get("side") == side for item in warnings):
            warnings.append({
                "code": "HAND_GEOMETRY_UNSUPPORTED",
                "side": side,
                "derivedMode": "unsupported",
                "blocking": str(analysis.get("requestedRigProfile") or analysis.get("requested_rig_profile") or "BODY_BASIC")
                in {"BODY_HANDS_BASIC", "FULL_HUMANOID", "FULL_BODY_HANDS_FACE"},
            })

    analysis["topology_capabilities"] = capabilities
    analysis["warnings"] = warnings
    _normalize_unstable_landmarks(analysis)
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    analysis["metrics"] = residuals._canonical_metrics(
        landmarks,
        analysis.get("metrics") if isinstance(analysis.get("metrics"), dict) else {},
    )
    _recompute_hand_profiles(analysis, capabilities)
    analysis["fullHumanoidRigReady"] = bool(
        analysis.get("bodyRigReady")
        and analysis.get("leftFingerRigReady")
        and analysis.get("rightFingerRigReady")
    )
    analysis.setdefault("diagnostics", {})["v41ResidualFinalization"] = {
        "version": "clouva-avatar-analyzer-v4.1-residual-finalization-1",
        "corruptHands": [side for side in ("left", "right") if _hand_is_corrupt(reports[side])],
        "lowConfidenceCount": analysis.get("metrics", {}).get("lowConfidenceCount", 0),
        "projectionMismatchCount": analysis.get("metrics", {}).get("projectionMismatchCount", 0),
    }
    return analysis


__all__ = ["apply_residual_repairs_v41"]
