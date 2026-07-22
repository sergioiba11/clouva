"""MediaPipe Tasks auxiliary process for CLOUVA technical renders.

V3 evaluates both the neutral RGB render and an edge-enhanced render. MediaPipe
still supplies only 2D candidates; confidence is derived from detector agreement
and handedness instead of assigning one fixed value to every landmark.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, List

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

FACE_MODEL = Path(os.environ.get("CLOUVA_FACE_LANDMARKER_MODEL", "/app/models/face_landmarker.task"))
HAND_MODEL = Path(os.environ.get("CLOUVA_HAND_LANDMARKER_MODEL", "/app/models/hand_landmarker.task"))

FACE_MAP: Dict[str, List[int]] = {
    "eye_l_center": [468], "eye_l_inner": [362], "eye_l_outer": [263],
    "eye_l_upper": [386, 385, 384], "eye_l_lower": [374, 380, 381],
    "eye_r_center": [473], "eye_r_inner": [133], "eye_r_outer": [33],
    "eye_r_upper": [159, 158, 157], "eye_r_lower": [145, 144, 163],
    "nose_bridge_top": [168], "nose_bridge_mid": [6], "nose_tip": [1],
    "nose_base": [2], "nostril_l": [327], "nostril_r": [98],
    "nose_wing_l": [358], "nose_wing_r": [129],
    "mouth_center": [13, 14], "mouth_corner_l": [291], "mouth_corner_r": [61],
    "upper_lip_center": [13], "upper_lip_l": [270, 269], "upper_lip_r": [40, 39],
    "lower_lip_center": [14], "lower_lip_l": [321, 375], "lower_lip_r": [91, 146],
    "mouth_opening_upper": [13], "mouth_opening_lower": [14],
    "chin": [152], "jaw_l": [454], "jaw_r": [234],
    "cheek_l": [425], "cheek_r": [205], "forehead_center": [10],
    "temple_l": [356], "temple_r": [127], "brow_l_inner": [336],
    "brow_l_outer": [300], "brow_r_inner": [107], "brow_r_outer": [70],
}

HAND_MAP = {
    "wrist": 0,
    "thumb_01": 1, "thumb_02": 2, "thumb_03": 3, "thumb_tip": 4,
    "index_01": 5, "index_02": 6, "index_03": 7, "index_tip": 8,
    "middle_01": 9, "middle_02": 10, "middle_03": 11, "middle_tip": 12,
    "ring_01": 13, "ring_02": 14, "ring_03": 15, "ring_tip": 16,
    "pinky_01": 17, "pinky_02": 18, "pinky_03": 19, "pinky_tip": 20,
}


def _average(landmarks, indices: Iterable[int]):
    selected = [landmarks[index] for index in indices if index < len(landmarks)]
    if not selected:
        return None
    count = float(len(selected))
    return {
        "x": sum(float(item.x) for item in selected) / count,
        "y": sum(float(item.y) for item in selected) / count,
        "z": sum(float(item.z) for item in selected) / count,
    }


def _face_detector():
    if not FACE_MODEL.is_file():
        raise FileNotFoundError(f"Face Landmarker model missing: {FACE_MODEL}")
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(FACE_MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.35,
        min_face_presence_confidence=0.35,
        min_tracking_confidence=0.35,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    return vision.FaceLandmarker.create_from_options(options)


def _hand_detector():
    if not HAND_MODEL.is_file():
        raise FileNotFoundError(f"Hand Landmarker model missing: {HAND_MODEL}")
    options = vision.HandLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(HAND_MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.25,
        min_hand_presence_confidence=0.25,
        min_tracking_confidence=0.25,
    )
    return vision.HandLandmarker.create_from_options(options)


def _distance(first: dict, second: dict):
    return math.hypot(float(first["x"]) - float(second["x"]), float(first["y"]) - float(second["y"]))


def _agreement_confidence(rgb: dict | None, edge: dict | None, base: float):
    if rgb is not None and edge is not None:
        distance = _distance(rgb, edge)
        agreement = max(0.0, min(1.0, 1.0 - distance / 0.065))
        confidence = max(0.42, min(0.97, base * 0.50 + agreement * 0.50))
        point = {
            "x": (float(rgb["x"]) + float(edge["x"])) * 0.5,
            "y": (float(rgb["y"]) + float(edge["y"])) * 0.5,
            "z": (float(rgb.get("z", 0.0)) + float(edge.get("z", 0.0))) * 0.5,
        }
        return point, confidence, agreement, ["rgb", "edge"]
    point = rgb or edge
    if point is None:
        return None, 0.0, 0.0, []
    return point, max(0.38, min(0.72, base * 0.72)), 0.35, ["rgb" if rgb else "edge"]


def _face_points(detector, path: str | None):
    if not path or not Path(path).is_file():
        return {}
    result = detector.detect(mp.Image.create_from_file(path))
    if not result.face_landmarks:
        return {}
    landmarks = result.face_landmarks[0]
    return {name: _average(landmarks, indices) for name, indices in FACE_MAP.items()}


def _hand_points(detector, path: str | None):
    if not path or not Path(path).is_file():
        return {}, None, 0.0
    result = detector.detect(mp.Image.create_from_file(path))
    if not result.hand_landmarks:
        return {}, None, 0.0
    detector_handedness = None
    handedness_score = 0.55
    if result.handedness and result.handedness[0]:
        category = result.handedness[0][0]
        detector_handedness = category.category_name
        handedness_score = float(category.score or handedness_score)
    landmarks = result.hand_landmarks[0]
    return {
        base_name: {
            "x": float(landmarks[index].x),
            "y": float(landmarks[index].y),
            "z": float(landmarks[index].z),
        }
        for base_name, index in HAND_MAP.items() if index < len(landmarks)
    }, detector_handedness, handedness_score


def _detect_face(detector, view: dict):
    rgb = _face_points(detector, view.get("path"))
    edge = _face_points(detector, view.get("edgePath"))
    if not rgb and not edge:
        return [], {"code": "FACE_NOT_DETECTED", "view": view["name"]}
    candidates = []
    for name in FACE_MAP:
        point, confidence, agreement, variants = _agreement_confidence(rgb.get(name), edge.get(name), 0.78)
        if point is None:
            continue
        candidates.append({
            "name": name,
            "x": point["x"], "y": point["y"], "detectorDepth": point["z"],
            "detectorConfidence": confidence,
            "viewQualityConfidence": agreement,
            "visualConfidence": confidence,
            "view": view["name"], "region": "face",
            "indices": FACE_MAP[name], "renderVariants": variants,
        })
    return candidates, None


def _detect_hand(detector, view: dict):
    rgb, rgb_handedness, rgb_score = _hand_points(detector, view.get("path"))
    edge, edge_handedness, edge_score = _hand_points(detector, view.get("edgePath"))
    if not rgb and not edge:
        return [], {"code": "HAND_NOT_DETECTED", "view": view["name"], "side": view.get("side")}
    detector_handedness = rgb_handedness or edge_handedness
    handedness_score = max(rgb_score, edge_score, 0.45)
    suffix = "l" if view.get("side") == "left" else "r"
    candidates = []
    for base_name, index in HAND_MAP.items():
        point, confidence, agreement, variants = _agreement_confidence(
            rgb.get(base_name), edge.get(base_name), handedness_score,
        )
        if point is None:
            continue
        candidates.append({
            "name": f"{base_name}_{suffix}",
            "x": point["x"], "y": point["y"], "detectorDepth": point["z"],
            "detectorConfidence": confidence,
            "viewQualityConfidence": agreement,
            "visualConfidence": confidence,
            "view": view["name"], "region": "hand", "side": view.get("side"),
            "detectorHandedness": detector_handedness,
            "handednessConfidence": handedness_score,
            "index": index, "canonicalIndex": index, "renderVariants": variants,
        })
    return candidates, None


def run(request_path: Path, output_path: Path):
    request = json.loads(request_path.read_text(encoding="utf-8"))
    views = request.get("views") or []
    output = {
        "version": "clouva-mediapipe-tasks-v3-dual-render-agreement",
        "faceModel": str(FACE_MODEL), "handModel": str(HAND_MODEL),
        "handLandmarkCount": len(HAND_MAP), "views": [], "errors": [],
    }
    face_detector = _face_detector()
    hand_detector = _hand_detector()
    try:
        for view in views:
            try:
                if view.get("region") == "face":
                    candidates, error = _detect_face(face_detector, view)
                elif view.get("region") == "hand":
                    candidates, error = _detect_hand(hand_detector, view)
                else:
                    candidates, error = [], {"code": "UNKNOWN_REGION", "view": view.get("name")}
                output["views"].append({
                    "name": view.get("name"), "region": view.get("region"),
                    "side": view.get("side"), "candidates": candidates,
                })
                if error:
                    output["errors"].append(error)
            except Exception as exc:
                output["errors"].append({
                    "code": "DETECTOR_VIEW_FAILED", "view": view.get("name"), "message": str(exc),
                })
    finally:
        face_detector.close(); hand_detector.close()
    output_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    return output


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: landmark_detector_2d.py request.json output.json")
    run(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())


if __name__ == "__main__":
    main()
