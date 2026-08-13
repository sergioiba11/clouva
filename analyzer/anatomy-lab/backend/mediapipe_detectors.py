from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
except Exception:
    mp = None
    python = None
    vision = None

POSE_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
    "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle",
    "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]
HAND_NAMES = [
    "wrist", "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip", "index_mcp", "index_pip", "index_dip",
    "index_tip", "middle_mcp", "middle_pip", "middle_dip", "middle_tip", "ring_mcp", "ring_pip", "ring_dip",
    "ring_tip", "pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip",
]
FACE_SEMANTIC = {
    "left_eye_outer": 33, "left_eye_inner": 133, "right_eye_inner": 362, "right_eye_outer": 263,
    "left_iris": 468, "right_iris": 473, "nose_tip": 1, "nose_bridge": 168,
    "mouth_left": 61, "mouth_right": 291, "upper_lip": 13, "lower_lip": 14,
    "chin": 152, "forehead": 10, "left_cheek": 205, "right_cheek": 425,
    "left_brow": 70, "right_brow": 300,
}

def _image(path: str):
    return mp.Image.create_from_file(path)

def _landmark_dict(name: str, index: int, landmark: Any, group: str, side: str | None = None) -> dict:
    return {
        "name": name,
        "index": index,
        "x": float(landmark.x),
        "y": float(landmark.y),
        "z": float(getattr(landmark, "z", 0.0) or 0.0),
        "visibility": float(getattr(landmark, "visibility", 1.0) or 1.0),
        "presence": float(getattr(landmark, "presence", 1.0) or 1.0),
        "group": group,
        "side": side,
    }

class MediaPipeDetectors:
    def __init__(self, models_dir: Path):
        if mp is None or vision is None:
            raise RuntimeError("MEDIAPIPE_NOT_INSTALLED")
        required = {
            "pose": models_dir / "pose_landmarker.task",
            "face": models_dir / "face_landmarker.task",
            "hand": models_dir / "hand_landmarker.task",
        }
        missing = [name for name, path in required.items() if not path.is_file()]
        if missing:
            raise RuntimeError(f"MEDIAPIPE_MODELS_MISSING:{','.join(missing)}")
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(required["pose"])),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.2,
            min_pose_presence_confidence=0.2,
            min_tracking_confidence=0.2,
            output_segmentation_masks=False,
        ))
        self.face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(required["face"])),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.15,
            min_face_presence_confidence=0.15,
            min_tracking_confidence=0.15,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        ))
        self.hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(required["hand"])),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.12,
            min_hand_presence_confidence=0.12,
            min_tracking_confidence=0.12,
        ))

    def close(self) -> None:
        self.pose.close()
        self.face.close()
        self.hand.close()

    def detect_pose(self, path: str) -> list[dict]:
        result = self.pose.detect(_image(path))
        if not result.pose_landmarks:
            return []
        return [_landmark_dict(POSE_NAMES[i] if i < len(POSE_NAMES) else f"pose_{i}", i, value, "body")
                for i, value in enumerate(result.pose_landmarks[0])]

    def detect_face(self, path: str) -> list[dict]:
        result = self.face.detect(_image(path))
        if not result.face_landmarks:
            return []
        raw = result.face_landmarks[0]
        semantic_by_index = {index: name for name, index in FACE_SEMANTIC.items()}
        output = []
        for index, value in enumerate(raw):
            name = semantic_by_index.get(index, f"face_{index:03d}")
            output.append(_landmark_dict(name, index, value, "face"))
        return output

    def detect_hands(self, path: str) -> list[dict]:
        result = self.hand.detect(_image(path))
        output: list[dict] = []
        for hand_index, landmarks in enumerate(result.hand_landmarks or []):
            side = None
            score = 0.5
            if result.handedness and hand_index < len(result.handedness) and result.handedness[hand_index]:
                category = result.handedness[hand_index][0]
                side = str(category.category_name or "").lower()
                score = float(category.score or 0.5)
            for i, value in enumerate(landmarks):
                item = _landmark_dict(HAND_NAMES[i] if i < len(HAND_NAMES) else f"hand_{i}", i, value, "hand", side)
                item["handedness_confidence"] = score
                output.append(item)
        return output
