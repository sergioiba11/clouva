"""
Patch v8.3: utilidades de limpieza facial y anchors de aritos.
Este módulo está pensado para copiarse encima del laboratorio local.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple, Iterable
import math

Vec3 = Tuple[float, float, float]

@dataclass
class FaceRejectSummary:
    on_neck: int = 0
    feature_zone: int = 0
    behind_head: int = 0
    outside_head: int = 0


def distance(a: Vec3, b: Vec3) -> float:
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2)


def clamp_face_landmarks(landmarks: Iterable[dict], *, allowed_regions=None, blocked_regions=None) -> Tuple[List[dict], List[dict], FaceRejectSummary]:
    allowed_regions = set(allowed_regions or {
        'face','forehead','left_eye','right_eye','left_brow','right_brow','nose',
        'left_cheek','right_cheek','upper_lip','lower_lip','jaw','chin','left_ear','right_ear'
    })
    blocked_regions = set(blocked_regions or {'neck','torso','back','scalp_back'})
    accepted, rejected = [], []
    summary = FaceRejectSummary()
    for lm in landmarks:
        region = lm.get('region')
        if region in blocked_regions:
            reason = 'on_neck' if region == 'neck' else 'outside_head'
            lm = {**lm, 'rejected': True, 'reject_reason': reason}
            rejected.append(lm)
            if reason == 'on_neck':
                summary.on_neck += 1
            else:
                summary.outside_head += 1
            continue
        if region is not None and region not in allowed_regions:
            lm = {**lm, 'rejected': True, 'reject_reason': 'feature_zone'}
            rejected.append(lm)
            summary.feature_zone += 1
            continue
        accepted.append({**lm, 'rejected': False})
    return accepted, rejected, summary


def compute_face_ready(accepted_count: int, rejected_count: int, critical_rejects: int = 0) -> bool:
    return accepted_count >= 440 and rejected_count <= 2 and critical_rejects == 0


def build_earlobe_anchors(left_ear_point: dict | None, right_ear_point: dict | None) -> Dict[str, dict]:
    anchors = {}
    if left_ear_point:
        anchors['left_earlobe_anchor'] = {
            'name': 'left_earlobe_anchor',
            'position': left_ear_point.get('position') or left_ear_point.get('source_position'),
            'triangle_id': left_ear_point.get('triangle_id'),
            'barycentric': left_ear_point.get('barycentric'),
            'surface_normal': left_ear_point.get('surface_normal'),
            'direction': 'left'
        }
    if right_ear_point:
        anchors['right_earlobe_anchor'] = {
            'name': 'right_earlobe_anchor',
            'position': right_ear_point.get('position') or right_ear_point.get('source_position'),
            'triangle_id': right_ear_point.get('triangle_id'),
            'barycentric': right_ear_point.get('barycentric'),
            'surface_normal': right_ear_point.get('surface_normal'),
            'direction': 'right'
        }
    return anchors
