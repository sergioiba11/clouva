import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v16_base as base

# Runtime revision of V16. The worker still exposes the stable V16 route,
# but this module constrains freshly-created thumb chains to the detected
# hand continuation before weights and validation are generated.
VERSION = "clouva-blender-autorig-v16.1-thumb-axis"
THUMB_AXIS_METHOD = "fresh-thumb-axis-from-hand-continuation-v16.1"

# Re-export the public helpers used by the Docker smoke tests and E2E test.
v15 = base.v15
create_fresh_schema_armature = base.create_fresh_schema_armature
sha256_file = base.sha256_file
args_after_separator = base.args_after_separator


def _unit(value, fallback):
    result = Vector(value)
    if result.length <= 1e-7:
        result = Vector(fallback)
    result.normalize()
    return result


def _world_point(armature, point):
    return armature.matrix_world @ Vector(point)


def _local_point(armature, point):
    return armature.matrix_world.inverted_safe() @ Vector(point)


def constrain_fresh_thumb_axes(armature, report):
    """Keep new thumb bones anatomical without allowing a sideways-only chain."""
    hand_names = report.get("handSources") or {}
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    if armature.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones

    left = bones.get(hand_names.get("l", ""))
    right = bones.get(hand_names.get("r", ""))
    if left is None or right is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise RuntimeError("Fresh thumb-axis correction could not resolve both hand bones")

    lateral = _unit(
        _world_point(armature, left.head) - _world_point(armature, right.head),
        (1.0, 0.0, 0.0),
    )
    corrections = {}

    try:
        for side in ("l", "r"):
            hand = left if side == "l" else right
            first = bones.get(f"clouva_thumb_01_{side}")
            second = bones.get(f"clouva_thumb_02_{side}")
            third = bones.get(f"clouva_thumb_03_{side}")
            if first is None or second is None or third is None:
                raise RuntimeError(f"Fresh thumb chain is incomplete on side {side}")

            wrist = _world_point(armature, hand.head)
            if hand.parent is not None:
                continuation = wrist - _world_point(armature, hand.parent.head)
            else:
                continuation = _world_point(armature, hand.tail) - wrist
            continuation = _unit(continuation, (0.0, 0.0, -1.0))

            forward = continuation - lateral * continuation.dot(lateral)
            if forward.length <= 1e-7:
                own = _world_point(armature, hand.tail) - wrist
                forward = own - lateral * own.dot(lateral)
            forward = _unit(forward, (0.0, 0.0, -1.0))

            root = _world_point(armature, first.head)
            current_chain = _world_point(armature, third.head) - root
            current_direction = _unit(current_chain, continuation)
            before_lateral = float(current_direction.dot(lateral))
            root_side = float((root - wrist).dot(lateral))
            root_sign = 1.0 if root_side >= 0.0 else -1.0

            # Preserve the side on which the generated thumb root was found,
            # but cap lateral travel well below the validator's 0.72 limit.
            target_lateral = max(-0.42, min(0.42, before_lateral))
            if abs(target_lateral) < 0.24:
                target_lateral = root_sign * 0.24
            forward_weight = math.sqrt(max(0.0, 1.0 - target_lateral * target_lateral))
            direction = _unit(forward * forward_weight + lateral * target_lateral, continuation)

            # A finger must continue away from the forearm, not fold back toward it.
            if direction.dot(continuation) < 0.45:
                direction = _unit(direction * 0.35 + continuation * 0.65, continuation)
                lateral_component = float(direction.dot(lateral))
                if abs(lateral_component) > 0.58:
                    target_lateral = math.copysign(0.42, lateral_component)
                    direction = _unit(
                        forward * math.sqrt(1.0 - target_lateral * target_lateral)
                        + lateral * target_lateral,
                        continuation,
                    )

            segment_bones = (first, second, third)
            lengths = [
                max(
                    (_world_point(armature, bone.tail) - _world_point(armature, bone.head)).length,
                    1e-4,
                )
                for bone in segment_bones
            ]
            cursor = root
            previous = first.parent
            for index, (bone, length) in enumerate(zip(segment_bones, lengths)):
                bone.head = _local_point(armature, cursor)
                cursor = cursor + direction * length
                bone.tail = _local_point(armature, cursor)
                bone.parent = previous
                bone.use_connect = index > 0
                bone.use_deform = True
                bone.roll = 0.0
                base.v15.v11.v10.set_no_inherited_scale(bone)
                previous = bone

            after_direction = _unit(
                _world_point(armature, third.head) - _world_point(armature, first.head),
                direction,
            )
            corrections[side] = {
                "method": THUMB_AXIS_METHOD,
                "beforeLateralAlignment": abs(before_lateral),
                "afterLateralAlignment": abs(float(after_direction.dot(lateral))),
                "handContinuationAlignment": float(after_direction.dot(continuation)),
                "rootSide": root_side,
            }
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.context.view_layer.update()

    for side, proof in corrections.items():
        if proof["afterLateralAlignment"] > 0.58:
            raise RuntimeError(f"Fresh thumb axis remained too lateral on side {side}: {proof}")
        if proof["handContinuationAlignment"] < 0.30:
            raise RuntimeError(f"Fresh thumb axis did not follow the hand on side {side}: {proof}")
    return corrections


def run(input_path, output_path, metadata_path):
    original_fit = base.v15.fit_fingers_to_target_mesh

    def fit_then_constrain(armature, meshes, report):
        hand_fit = original_fit(armature, meshes, report)
        corrections = constrain_fresh_thumb_axes(armature, report)
        for side in ("l", "r"):
            if side in hand_fit:
                hand_fit[side]["thumbAxis"] = corrections.get(side)
        report["thumbAxisCorrection"] = corrections
        return hand_fit

    base.v15.fit_fingers_to_target_mesh = fit_then_constrain
    try:
        profile = base.run(input_path, output_path, metadata_path)
    finally:
        base.v15.fit_fingers_to_target_mesh = original_fit

    # Base V16 already wrote a valid GLB and metadata. Add the precise runtime
    # revision to the stored proof without changing the stable API contract.
    profile["runtimeVersion"] = VERSION
    profile["thumbAxisMethod"] = THUMB_AXIS_METHOD
    Path(metadata_path).write_text(json.dumps(profile, separators=(",", ":")), encoding="utf-8")
    return profile


def main():
    arguments = args_after_separator()
    if len(arguments) < 3:
        raise RuntimeError("Usage: autorig_avatar_v17.py input.glb output.glb metadata.json")
    input_path, output_path, metadata_path = map(lambda value: Path(value).resolve(), arguments[:3])
    if not input_path.is_file():
        raise RuntimeError("Original clean avatar GLB not found")
    run(input_path, output_path, metadata_path)


if __name__ == "__main__":
    main()
