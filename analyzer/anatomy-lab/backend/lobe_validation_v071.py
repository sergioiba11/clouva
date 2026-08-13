"""Parche conceptual v0.7.1 para fijar pines de lóbulos en la zona baja/central."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable, Dict, List, Tuple

@dataclass
class LobeValidationResult:
    valid: bool
    reason: str
    vertical_error_m: float
    pair_height_delta_m: float


def validate_earlobe_pin(pin_z: float, target_z: float, *, max_vertical_error_m: float = 0.015) -> tuple[bool, float]:
    err = abs(pin_z - target_z)
    return err <= max_vertical_error_m, err


def validate_earlobe_pair(left_pin_z: float, right_pin_z: float, left_target_z: float, right_target_z: float,
                          *, max_vertical_error_m: float = 0.015, max_pair_delta_m: float = 0.018) -> LobeValidationResult:
    left_ok, left_err = validate_earlobe_pin(left_pin_z, left_target_z, max_vertical_error_m=max_vertical_error_m)
    right_ok, right_err = validate_earlobe_pin(right_pin_z, right_target_z, max_vertical_error_m=max_vertical_error_m)
    pair_delta = abs(left_pin_z - right_pin_z)
    if not left_ok or not right_ok:
        return LobeValidationResult(False, 'vertical_zone_miss', max(left_err, right_err), pair_delta)
    if pair_delta > max_pair_delta_m:
        return LobeValidationResult(False, 'pair_height_mismatch', max(left_err, right_err), pair_delta)
    return LobeValidationResult(True, 'ok', max(left_err, right_err), pair_delta)


def choose_lower_lobe_candidate(candidates: Iterable[dict], target_z: float) -> dict | None:
    """Elige el candidato más cercano al objetivo vertical, favoreciendo tercio inferior y centro lateral."""
    best = None
    best_score = None
    for c in candidates:
        z = c.get('canonical_position', [0,0,0])[2]
        x = abs(c.get('canonical_position', [0,0,0])[0])
        y = abs(c.get('canonical_position', [0,0,0])[1])
        vertical_error = abs(z - target_z)
        score = vertical_error * 10.0 + y * 0.75 + abs(x - 0.185) * 0.5
        if best_score is None or score < best_score:
            best = c
            best_score = score
    return best
