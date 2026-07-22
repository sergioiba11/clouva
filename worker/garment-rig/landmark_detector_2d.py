"""MediaPipe Tasks auxiliary process for CLOUVA technical renders.

This file runs with the container's system Python, not Blender's executable.
It emits only candidate 2D landmarks. Blender remains responsible for 3D ray
projection, mesh-class filtering and multiview validation.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, List

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

FACE_MODEL = Path(os.environ.get("CLOUVA_FACE_LANDMARKER_MODEL", "/app/models/face_landmarker.task"))
HAND_MODEL = Path(os.environ.get("CLOUVA_HAND_LANDMARKER_MODEL", "/app/models/hand_landmarker.task"))

# Subject-relative names. The Blender render is not mirrored.
FACE_MAP: Dict[str, List[int]] = {
    "eye_l_center": [468],
    "eye_l_inner": [362],
    "eye_l_outer": [263],
    "eye_l_upper": [386, 385, 384],
    "eye_l_lower": [374, 380, 381],
    "eye_r_center": [473],
    "eye_r_inner": [133],
    "eye_r_outer": [33],
    "eye_r_upper": [159, 158, 157],
    "eye_r_lower": [145, 144, 163],
    "nose_bridge_top": [168],
    "nose_bridge_mid": [6],
    "nose_tip": [1],
    "nose_base": [2],
    "nostril_l": [327],
    "nostril_r": [98],
    "nose_wing_l": [358],
    "nose_wing_r": [129],
    "mouth_center": [13, 14],
    "mouth_corner_l": [291],
    "mouth_corner_r": [61],
    "upper_lip_center": [13],
    "upper_lip_l": [270, 269],
    "upper_lip_r": [40, 39],
    "lower_lip_center": [14],
    "lower_lip_l": [321, 375],
    "lower_lip_r": [91, 146],
    "mouth_opening_upper": [13],
    "mouth_opening_lower": [14],
    "chin": [152],
    "jaw_l": [454],
    "jaw_r": [234],
    "cheek_l": [425],
    "cheek_r": [205],
    "forehead_center": [10],
    "temple_l": [356],
    "temple_r": [127],
    "brow_l_inner": [336],
    "brow_l_outer": [300],
    "brow_r_inner": [107],
    "brow_r_outer": [70],
}

HAND_MAP = {
    "wrist": 0,
    "thumb_metacarpal": 1,
    "thumb_01": 1,
    "thumb_02": 2,
    "thumb_03": 3,
    "thumb_tip": 4,
    "index_metacarpal": 5,
    "index_01": 5,
    "index_02": 6,
    "index_03": 7,
    "index_tip": 8,
    "middle_metacarpal": 9,
    "middle_01": 9,
    "middle_02": 10,
    "middle_03": 11,
    "middle_tip": 12,
    "ring_metacarpal": 13,
    "ring_01": 13,
    "ring_02": 14,
    "ring_03": 15,
    "ring_tip": 16,
    "pinky_metacarpal": 17,
    "pinky_01": 17,
    "pinky_02": 18,
    "pinky_03": 19,
    "pinky_tip": 20,
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


def _detect_face(detector, view: dict):
    image = mp.Image.create_from_file(view["path"])
    result = detector.detect(image)
    if not result.face_landmarks:
        return [], {"code": "FACE_NOT_DETECTED", "view": view["name"]}
    landmarks = result.face_landmarks[0]
    candidates = []
    for name, indices in FACE_MAP.items():
        point = _average(landmarks, indices)
        if point is None:
            continue
        candidates.append({
            "name": name,
            "x": point["x"],
            "y": point["y"],
            "detectorDepth": point["z"],
            "visualConfidence": 0.88,
            "view": view["name"],
            "region": "face",
            "indices": indices,
        })
    return candidates, None


def _detect_hand(detector, view: dict):
    image = mp.Image.create_from_file(view["path"])
    result = detector.detect(image)
    if not result.hand_landmarks:
        return [], {"code": "HAND_NOT_DETECTED", "view": view["name"], "side": view.get("side")}
    landmarks = result.hand_landmarks[0]
    detector_handedness = None
    handedness_score = 0.75
    if result.handedness and result.handedness[0]:
        category = result.handedness[0][0]
        detector_handedness = category.category_name
        handedness_score = float(category.score or handedness_score)
    suffix = "l" if view.get("side") == "left" else "r"
    candidates = []
    for base_name, index in HAND_MAP.items():
        if index >= len(landmarks):
            continue
        point = landmarks[index]
        candidates.append({
            "name": f"{base_name}_{suffix}",
            "x": float(point.x),
            "y": float(point.y),
            "detectorDepth": float(point.z),
            "visualConfidence": max(0.45, min(0.95, handedness_score)),
            "view": view["name"],
            "region": "hand",
            "side": view.get("side"),
            "detectorHandedness": detector_handedness,
            "index": index,
        })
    return candidates, None


def run(request_path: Path, output_path: Path):
    request = json.loads(request_path.read_text(encoding="utf-8"))
    views = request.get("views") or []
    output = {
        "version": "clouva-mediapipe-tasks-v1",
        "faceModel": str(FACE_MODEL),
        "handModel": str(HAND_MODEL),
        "views": [],
        "errors": [],
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
                    "name": view.get("name"),
                    "region": view.get("region"),
                    "side": view.get("side"),
                    "candidates": candidates,
                })
                if error:
                    output["errors"].append(error)
            except Exception as exc:  # one bad render must not hide other views
                output["errors"].append({
                    "code": "DETECTOR_VIEW_FAILED",
                    "view": view.get("name"),
                    "message": str(exc),
                })
    finally:
        face_detector.close()
        hand_detector.close()
    output_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    return output


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: landmark_detector_2d.py request.json output.json")
    run(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())


if __name__ == "__main__":
    main()
