import hashlib
import json
import math
import os
import sys
import time
import uuid
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v12 as v15
from avatar_reference import canonicalize_and_validate_bones

VERSION = "clouva-blender-autorig-v16-fresh-schema"
RIG_METHOD = "fresh-schema-mesh-landmarks-v16"
HAND_METHOD = "target-mesh-distal-axis-and-lateral-spread-v16"
WEIGHT_METHOD = "automatic-heat-clean-4-influences-v16"
POSE_METHOD = "non-destructive-articulation-smoke-test-v16"
SCHEMA_METADATA = Path(os.environ.get(
    "CLOUVA_AVATAR_REFERENCE_METADATA_PATH",
    SCRIPT_DIR / "avatar-reference" / "clouva_avatar_data.json",
))

_IMPORT_REPORT = {}


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def args_after_separator():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    return sys.argv[sys.argv.index("--") + 1:]


def _percentile(values, factor, fallback):
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return float(fallback)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * factor)))
    return ordered[index]


def _median(values, fallback=0.0):
    return _percentile(values, 0.5, fallback)


def _mean_point(points, fallback):
    if not points:
        return fallback.copy()
    total = Vector((0.0, 0.0, 0.0))
    for point in points:
        total += point
    return total / len(points)


def _clamp(value, low, high):
    return max(low, min(high, value))


def _finite_vector(value):
    return all(math.isfinite(float(component)) for component in value)


def import_original_fresh(path):
    """Load only the submitted geometry and destroy every previous rig artifact."""
    global _IMPORT_REPORT
    v15.clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and len(obj.data.vertices)]
    if not meshes:
        raise RuntimeError("The original avatar has no usable mesh")

    old_armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    removed_modifiers = 0
    removed_groups = 0
    removed_actions = 0

    v15.normalize(meshes)
    for mesh in meshes:
        if mesh.animation_data is not None:
            mesh.animation_data_clear()
            removed_actions += 1
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                mesh.modifiers.remove(modifier)
                removed_modifiers += 1
        removed_groups += len(mesh.vertex_groups)
        mesh.vertex_groups.clear()
        mesh.parent = None
        mesh.matrix_parent_inverse = Matrix.Identity(4)

    for armature in old_armatures:
        if armature.animation_data is not None:
            armature.animation_data_clear()
            removed_actions += 1
        bpy.data.objects.remove(armature, do_unlink=True)

    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    bpy.context.view_layer.update()
    _IMPORT_REPORT = {
        "source": "original-clean-glb",
        "oldArmaturesRemoved": len(old_armatures),
        "armatureModifiersRemoved": removed_modifiers,
        "vertexGroupsRemoved": removed_groups,
        "animationBlocksRemoved": removed_actions,
        "meshCount": len(meshes),
        "vertexCount": sum(len(mesh.data.vertices) for mesh in meshes),
    }
    return meshes


def create_fresh_schema_armature():
    """Create a brand-new Blender Armature from the CLOUVA schema, never from an FBX rig."""
    if not SCHEMA_METADATA.is_file():
        raise RuntimeError("CLOUVA skeleton schema metadata is missing")
    metadata = json.loads(SCHEMA_METADATA.read_text(encoding="utf-8"))
    schema = sorted(
        [item for item in metadata.get("bones", []) if isinstance(item, dict) and item.get("name")],
        key=lambda item: int(item.get("index", 0)),
    )
    if not schema:
        raise RuntimeError("CLOUVA_SKELETON_SCHEMA contains no bones")

    data = bpy.data.armatures.new("CLOUVA_SKELETON_SCHEMA")
    armature = bpy.data.objects.new(f"CLOUVA_RIG_{uuid.uuid4().hex[:10]}", data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    armature.data.pose_position = "REST"
    armature["clouva_generated_from_scratch"] = True
    armature["clouva_schema_version"] = int(metadata.get("schemaVersion", 1))

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        created = {}
        for index, item in enumerate(schema):
            bone = data.edit_bones.new(str(item["name"]))
            bone.head = Vector((0.0, 0.0, index * 0.002))
            bone.tail = Vector((0.0, 0.0, index * 0.002 + 0.001))
            bone.use_deform = str(item["name"]).lower() not in {"head_end", "headfront"}
            created[bone.name] = bone
        for item in schema:
            parent_name = item.get("parent")
            if parent_name:
                created[str(item["name"])].parent = created.get(str(parent_name))
                created[str(item["name"])].use_connect = False
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")

    canonicalize_and_validate_bones(armature, metadata)
    bpy.context.view_layer.update()
    return armature, {
        "method": "new-armature-from-clouva-skeleton-schema-v16",
        "schemaVersion": int(metadata.get("schemaVersion", 1)),
        "bonesCreated": len(schema),
        "boneNames": [str(item["name"]) for item in schema],
        "armatureObject": armature.name,
        "reusedArmature": False,
        "schemaSha256": sha256_file(SCHEMA_METADATA),
    }


class MeshLandmarkDetector:
    def __init__(self, meshes):
        self.meshes = meshes
        self.minimum, self.maximum, self.size = v15.bounds(meshes)
        self.height = float(self.size.z)
        self.width = float(self.size.x)
        self.depth = float(self.size.y)
        if self.height <= 1e-6 or self.width <= 1e-6:
            raise RuntimeError("Avatar geometry is too small for landmark detection")
        self.points = [mesh.matrix_world @ vertex.co for mesh in meshes for vertex in mesh.data.vertices]
        self.center_x = _median([point.x for point in self.points], (self.minimum.x + self.maximum.x) * 0.5)
        self.center_y = _median([point.y for point in self.points], (self.minimum.y + self.maximum.y) * 0.5)
        self.base_z = float(self.minimum.z)
        self.top_z = float(self.maximum.z)

    def z(self, factor):
        return self.base_z + self.height * factor

    def slice(self, z_value, half=0.012):
        tolerance = self.height * half
        selected = [point for point in self.points if abs(float(point.z) - float(z_value)) <= tolerance]
        if selected:
            return selected
        count = max(32, len(self.points) // 700)
        return sorted(self.points, key=lambda point: abs(float(point.z) - float(z_value)))[:count]

    def central_slice(self, z_value, lateral=0.34, half=0.012):
        selected = [
            point for point in self.slice(z_value, half)
            if abs(float(point.x) - self.center_x) <= self.width * lateral
        ]
        return selected or self.slice(z_value, half)

    def section(self, z_value, lateral=0.34, half=0.012):
        points = self.central_slice(z_value, lateral, half)
        xs = [float(point.x) for point in points]
        ys = [float(point.y) for point in points]
        return {
            "z": float(z_value),
            "points": points,
            "center": Vector((_median(xs, self.center_x), _median(ys, self.center_y), float(z_value))),
            "halfWidth": max(
                1e-6,
                (_percentile(xs, 0.90, self.center_x) - _percentile(xs, 0.10, self.center_x)) * 0.5,
            ),
            "depth": max(
                1e-6,
                _percentile(ys, 0.90, self.center_y) - _percentile(ys, 0.10, self.center_y),
            ),
        }

    def scan_sections(self, start, end, steps, lateral=0.34):
        return [
            self.section(self.z(start + (end - start) * index / max(steps - 1, 1)), lateral)
            for index in range(steps)
        ]

    def narrowest(self, start, end, steps, lateral=0.34):
        return min(self.scan_sections(start, end, steps, lateral), key=lambda section: section["halfWidth"])

    def widest(self, start, end, steps, lateral=0.34):
        return max(self.scan_sections(start, end, steps, lateral), key=lambda section: section["halfWidth"])

    def center_at(self, z_value, lateral=0.22):
        section = self.section(z_value, lateral)
        center = section["center"].copy()
        center.x = self.center_x
        center.z = float(z_value)
        return center, section

    def side_center(self, z_value, sign, inner=0.015, outer=0.30, half=0.018):
        candidates = []
        for point in self.slice(z_value, half):
            lateral = sign * (float(point.x) - self.center_x)
            if self.width * inner <= lateral <= self.width * outer:
                candidates.append(point)
        fallback = Vector((self.center_x + sign * self.width * 0.075, self.center_y, z_value))
        result = _mean_point(candidates, fallback)
        result.z = float(z_value)
        return result, len(candidates)

    def detect(self):
        neck_section = self.narrowest(0.68, 0.84, 17, lateral=0.31)
        neck_z = _clamp(neck_section["z"], self.z(0.68), self.z(0.84))

        shoulder_candidates = self.scan_sections(
            max(0.54, (neck_z - self.base_z) / self.height - 0.17),
            max(0.60, (neck_z - self.base_z) / self.height - 0.025),
            15,
            lateral=0.38,
        )
        shoulder_section = max(shoulder_candidates, key=lambda section: section["halfWidth"])
        shoulder_z = min(float(shoulder_section["z"]), neck_z - self.height * 0.018)
        chest_z = _clamp(
            shoulder_z - self.height * 0.055,
            self.z(0.54),
            shoulder_z - self.height * 0.018,
        )

        pelvis_section = self.widest(0.38, 0.53, 16, lateral=0.29)
        pelvis_z = _clamp(pelvis_section["z"], self.z(0.38), self.z(0.53))
        if chest_z - pelvis_z < self.height * 0.12:
            pelvis_z = chest_z - self.height * 0.17

        ankle_section = self.narrowest(0.045, 0.16, 13, lateral=0.26)
        ankle_z = _clamp(ankle_section["z"], self.z(0.045), self.z(0.16))

        pelvis, pelvis_info = self.center_at(pelvis_z, 0.20)
        lower_spine, lower_info = self.center_at(pelvis_z + (chest_z - pelvis_z) * 0.35, 0.20)
        mid_spine, mid_info = self.center_at(pelvis_z + (chest_z - pelvis_z) * 0.68, 0.22)
        chest, chest_info = self.center_at(chest_z, 0.25)
        neck_base, neck_info = self.center_at(neck_z, 0.24)

        central_head = [
            point for point in self.points
            if abs(float(point.x) - self.center_x) <= self.width * 0.28
            and float(point.z) >= neck_z
        ]
        head_top_z = _percentile([point.z for point in central_head], 0.995, self.top_z)
        head_top_z = _clamp(head_top_z, neck_z + self.height * 0.09, self.top_z)
        head_top, head_top_info = self.center_at(head_top_z, 0.30)

        neck_factor = (neck_z - self.base_z) / self.height
        head_top_factor = (head_top_z - self.base_z) / self.height
        scan_start = min(head_top_factor - 0.03, neck_factor + 0.01)
        scan_end = max(scan_start + 0.01, min(0.94, head_top_factor - 0.02))
        head_sections = self.scan_sections(scan_start, scan_end, 14, lateral=0.31)
        expanded = [
            section for section in head_sections
            if section["halfWidth"] >= neck_section["halfWidth"] * 1.35
        ]
        detected_skull_base_z = (
            float(expanded[0]["z"])
            if expanded
            else head_top_z - self.height * 0.17
        )
        skull_base_z = _clamp(
            detected_skull_base_z,
            head_top_z - self.height * 0.195,
            head_top_z - self.height * 0.105,
        )
        skull_base, skull_base_info = self.center_at(skull_base_z, 0.26)

        result = {
            "pelvis": pelvis,
            "lowerSpine": lower_spine,
            "midSpine": mid_spine,
            "chest": chest,
            "neckBase": neck_base,
            "skullBase": skull_base,
            "headTop": head_top,
            "sides": {},
        }
        confidence = {
            "pelvis": min(1.0, len(pelvis_info["points"]) / 160.0),
            "spine": min(1.0, (len(lower_info["points"]) + len(mid_info["points"])) / 280.0),
            "chest": min(1.0, len(chest_info["points"]) / 160.0),
            "neck": min(1.0, len(neck_info["points"]) / 110.0),
            "skullBase": min(1.0, len(skull_base_info["points"]) / 130.0),
            "head": min(1.0, max(len(central_head), len(head_top_info["points"])) / 220.0),
        }

        for side, sign in (("left", 1.0), ("right", -1.0)):
            shoulder_points = self.slice(shoulder_z, 0.022)
            side_shoulder = [
                point for point in shoulder_points
                if sign * (float(point.x) - self.center_x) > 0.0
                and abs(float(point.x) - self.center_x) <= self.width * 0.40
            ]
            lateral_values = [sign * (float(point.x) - self.center_x) for point in side_shoulder]
            lateral = _percentile(lateral_values, 0.84, self.width * 0.18)
            lateral = _clamp(lateral, self.width * 0.10, self.width * 0.34)
            near = [
                point for point in side_shoulder
                if abs(sign * (float(point.x) - self.center_x) - lateral) <= self.width * 0.045
            ]
            shoulder = _mean_point(
                near,
                Vector((self.center_x + sign * lateral, self.center_y, shoulder_z)),
            )
            shoulder.x = self.center_x + sign * lateral
            shoulder.z = shoulder_z

            arm_cloud = [
                point for point in self.points
                if pelvis_z - self.height * 0.035 <= float(point.z) <= shoulder_z + self.height * 0.035
                and sign * (float(point.x) - self.center_x) >= self.width * 0.14
            ]
            distances = [(point - shoulder).length for point in arm_cloud]
            distal_threshold = _percentile(distances, 0.90, self.height * 0.22)
            distal_points = [
                point for point in arm_cloud
                if (point - shoulder).length >= distal_threshold
            ]
            distal = _mean_point(
                distal_points,
                shoulder + Vector((sign * self.width * 0.25, 0.0, -self.height * 0.24)),
            )
            axis = distal - shoulder
            if axis.length < self.height * 0.14:
                raise RuntimeError(f"Could not detect a usable {side} arm axis")
            axis.normalize()
            projected = [
                ((point - shoulder).dot(axis), point)
                for point in arm_cloud
                if (point - shoulder).dot(axis) > 0.0
            ]
            extent = _percentile([distance for distance, _ in projected], 0.96, self.height * 0.30)
            extent = _clamp(extent, self.height * 0.16, self.height * 0.42)
            wrist_distance = extent * 0.78
            wrist_band = [
                point for distance, point in projected
                if abs(distance - wrist_distance) <= self.height * 0.018
            ]
            wrist = _mean_point(wrist_band, shoulder + axis * wrist_distance)
            elbow_target = extent * 0.47
            elbow_band = [
                point for distance, point in projected
                if abs(distance - elbow_target) <= self.height * 0.022
            ]
            elbow = _mean_point(elbow_band, shoulder + axis * elbow_target)
            palm_tip = shoulder + axis * min(extent * 0.92, wrist_distance + self.height * 0.055)

            hip, hip_count = self.side_center(pelvis_z, sign, 0.015, 0.23)
            ankle, ankle_count = self.side_center(ankle_z, sign, 0.015, 0.23)
            leg_axis = ankle - hip
            if leg_axis.length < self.height * 0.20:
                raise RuntimeError(f"Could not detect a usable {side} leg axis")
            knee_guess = hip.lerp(ankle, 0.51)
            knee_band = [
                point for point in self.points
                if abs(float(point.z) - float(knee_guess.z)) <= self.height * 0.025
                and sign * (float(point.x) - self.center_x) > 0.0
                and sign * (float(point.x) - self.center_x) <= self.width * 0.23
            ]
            knee = _mean_point(knee_band, knee_guess)
            knee.z = knee_guess.z

            result["sides"][side] = {
                "sign": sign,
                "shoulder": shoulder,
                "elbow": elbow,
                "wrist": wrist,
                "palmTip": palm_tip,
                "hip": hip,
                "knee": knee,
                "ankle": ankle,
                "armAxisExtent": extent,
            }
            confidence[side] = {
                "shoulder": min(1.0, len(near) / 45.0),
                "arm": min(1.0, len(arm_cloud) / 500.0),
                "wrist": min(1.0, len(wrist_band) / 35.0),
                "hip": min(1.0, hip_count / 80.0),
                "knee": min(1.0, len(knee_band) / 80.0),
                "ankle": min(1.0, ankle_count / 70.0),
            }

        return result, confidence


def fit_fresh_armature_to_mesh(armature, meshes):
    detector = MeshLandmarkDetector(meshes)
    landmarks, confidence = detector.detect()
    height = detector.height
    inverse = armature.matrix_world.inverted_safe()

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    if armature.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature.data.edit_bones

    def bone(name):
        found = bones.get(name)
        if found is None:
            bpy.ops.object.mode_set(mode="OBJECT")
            raise RuntimeError(f"CLOUVA_SKELETON_SCHEMA is missing {name}")
        return found

    def set_bone(name, head_world, tail_world, parent_name=None, connected=False, deform=True):
        current = bone(name)
        if not _finite_vector(head_world) or not _finite_vector(tail_world):
            raise RuntimeError(f"Non-finite landmark for {name}")
        if (tail_world - head_world).length < height * 0.003:
            raise RuntimeError(f"Landmark fit collapsed {name}")
        current.head = inverse @ head_world
        current.tail = inverse @ tail_world
        current.parent = bone(parent_name) if parent_name else None
        current.use_connect = bool(connected and parent_name)
        current.use_deform = deform
        v15.v11.v10.set_no_inherited_scale(current)
        return current

    pelvis = landmarks["pelvis"]
    lower_spine = landmarks["lowerSpine"]
    mid_spine = landmarks["midSpine"]
    chest = landmarks["chest"]
    neck_base = landmarks["neckBase"]
    skull_base = landmarks["skullBase"]
    head_top = landmarks["headTop"]

    set_bone("Hips", pelvis - Vector((0.0, 0.0, height * 0.025)), pelvis)
    # Preserve the exact Unreal hierarchy declared in clouva_avatar_data.json.
    set_bone("Spine02", pelvis, lower_spine, "Hips", True)
    set_bone("Spine01", lower_spine, mid_spine, "Spine02", True)
    set_bone("Spine", mid_spine, chest, "Spine01", True)
    set_bone("neck", chest, skull_base, "Spine", True)
    set_bone("Head", skull_base, head_top, "neck", True)
    set_bone(
        "head_end",
        head_top,
        head_top + Vector((0.0, 0.0, height * 0.014)),
        "Head",
        True,
        False,
    )
    forward = Vector((0.0, -1.0, 0.0))
    set_bone(
        "headfront",
        skull_base.lerp(head_top, 0.56),
        skull_base.lerp(head_top, 0.56) + forward * max(detector.depth * 0.32, height * 0.025),
        "Head",
        False,
        False,
    )

    side_names = {
        "left": ("LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase"),
        "right": ("RightShoulder", "RightArm", "RightForeArm", "RightHand", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"),
    }
    report_sides = {}
    for side, names in side_names.items():
        shoulder_name, arm_name, forearm_name, hand_name, thigh_name, calf_name, foot_name, toe_name = names
        item = landmarks["sides"][side]
        set_bone(shoulder_name, chest, item["shoulder"], "Spine", False)
        set_bone(arm_name, item["shoulder"], item["elbow"], shoulder_name, True)
        set_bone(forearm_name, item["elbow"], item["wrist"], arm_name, True)
        set_bone(hand_name, item["wrist"], item["palmTip"], forearm_name, True)
        set_bone(thigh_name, item["hip"], item["knee"], "Hips", False)
        set_bone(calf_name, item["knee"], item["ankle"], thigh_name, True)

        bottom = [
            point for point in detector.points
            if float(point.z) <= detector.z(0.10)
            and item["sign"] * (float(point.x) - detector.center_x) > 0.0
        ]
        if bottom:
            ys = [float(point.y) for point in bottom]
            forward_sign = -1.0 if abs(min(ys) - detector.center_y) >= abs(max(ys) - detector.center_y) else 1.0
            foot_extent = max(detector.height * 0.045, min(detector.height * 0.12, max(abs(y - detector.center_y) for y in ys)))
        else:
            forward_sign = -1.0
            foot_extent = detector.height * 0.085
        foot_tip = item["ankle"] + Vector((0.0, forward_sign * foot_extent, -detector.height * 0.012))
        foot_tip.z = max(detector.base_z + detector.height * 0.018, foot_tip.z)
        toe_tip = foot_tip + Vector((0.0, forward_sign * detector.height * 0.045, 0.0))
        set_bone(foot_name, item["ankle"], foot_tip, calf_name, True)
        set_bone(toe_name, foot_tip, toe_tip, foot_name, True)

        report_sides[side] = {
            key: [float(value) for value in item[key]]
            for key in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle")
        }
        report_sides[side]["armAxisExtent"] = float(item["armAxisExtent"])

    bpy.ops.armature.select_all(action="SELECT")
    try:
        bpy.ops.armature.calculate_roll(type="GLOBAL_POS_Z")
    except RuntimeError:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    flat_confidence = [
        float(value)
        for value in confidence.values()
        if isinstance(value, (int, float))
    ]
    for value in confidence.values():
        if isinstance(value, dict):
            flat_confidence.extend(float(item) for item in value.values())
    minimum_confidence = min(flat_confidence) if flat_confidence else 0.0
    return {
        "method": RIG_METHOD,
        "detector": "cross-section-width-plus-limb-axis",
        "height": detector.height,
        "width": detector.width,
        "depth": detector.depth,
        "landmarks": {
            "pelvis": [float(value) for value in pelvis],
            "lowerSpine": [float(value) for value in lower_spine],
            "midSpine": [float(value) for value in mid_spine],
            "chest": [float(value) for value in chest],
            "neckBase": [float(value) for value in neck_base],
            "skullBase": [float(value) for value in skull_base],
            "headTop": [float(value) for value in head_top],
            "sides": report_sides,
        },
        "confidence": confidence,
        "minimumConfidence": minimum_confidence,
        "head": {
            "method": "mesh-neck-section-to-crown-v16",
            "base": [float(value) for value in skull_base],
            "neckBase": [float(value) for value in neck_base],
            "crown": [float(value) for value in head_top],
            "lengthRatio": float((head_top - skull_base).length / detector.height),
            "terminalBone": "head_end",
        },
    }


def cleanup_weights_max_four(meshes):
    removed = 0
    normalized = 0
    max_observed = 0
    for mesh in meshes:
        groups = {group.index: group for group in mesh.vertex_groups}
        for vertex in mesh.data.vertices:
            influences = sorted(
                [(item.group, float(item.weight)) for item in vertex.groups if item.weight > 1e-8],
                key=lambda item: item[1],
                reverse=True,
            )
            if not influences:
                continue
            keep = influences[:4]
            total = sum(weight for _, weight in keep)
            if total <= 1e-12:
                continue
            for group_index, _ in influences[4:]:
                group = groups.get(group_index)
                if group is not None:
                    group.remove([vertex.index])
                    removed += 1
            for group_index, weight in keep:
                group = groups.get(group_index)
                if group is not None:
                    group.add([vertex.index], weight / total, "REPLACE")
            max_observed = max(max_observed, len(keep))
            normalized += 1

    vertices = sum(len(mesh.data.vertices) for mesh in meshes)
    weighted = sum(
        1 for mesh in meshes for vertex in mesh.data.vertices
        if any(item.weight > 1e-8 for item in vertex.groups)
    )
    return {
        "method": WEIGHT_METHOD,
        "maxInfluences": 4,
        "maxObservedInfluences": max_observed,
        "removedInfluences": removed,
        "normalizedVertices": normalized,
        "vertices": vertices,
        "weightedVertices": weighted,
        "weightedRatio": weighted / max(vertices, 1),
    }


def articulation_smoke_test(armature, meshes):
    rotations = {
        "LeftArm": (0.0, 0.0, math.radians(18.0)),
        "RightArm": (0.0, 0.0, math.radians(-18.0)),
        "LeftForeArm": (math.radians(22.0), 0.0, 0.0),
        "RightForeArm": (math.radians(22.0), 0.0, 0.0),
        "LeftLeg": (math.radians(14.0), 0.0, 0.0),
        "RightLeg": (math.radians(14.0), 0.0, 0.0),
        "neck": (0.0, 0.0, math.radians(8.0)),
    }
    originals = {}
    armature.data.pose_position = "POSE"
    for name, values in rotations.items():
        pose_bone = armature.pose.bones.get(name)
        if pose_bone is None:
            raise RuntimeError(f"Pose validation is missing {name}")
        pose_bone.rotation_mode = "XYZ"
        originals[name] = pose_bone.rotation_euler.copy()
        pose_bone.rotation_euler = values

    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    sampled = 0
    invalid = 0
    try:
        for mesh in meshes:
            evaluated = mesh.evaluated_get(depsgraph)
            evaluated_mesh = evaluated.to_mesh()
            try:
                step = max(1, len(evaluated_mesh.vertices) // 900)
                for index in range(0, len(evaluated_mesh.vertices), step):
                    point = evaluated.matrix_world @ evaluated_mesh.vertices[index].co
                    sampled += 1
                    if not _finite_vector(point):
                        invalid += 1
            finally:
                evaluated.to_mesh_clear()
    finally:
        for name, original in originals.items():
            armature.pose.bones[name].rotation_euler = original
        armature.data.pose_position = "REST"
        bpy.context.view_layer.update()

    if sampled == 0 or invalid:
        raise RuntimeError(f"Articulation validation produced invalid geometry: sampled={sampled} invalid={invalid}")
    return {
        "method": POSE_METHOD,
        "sampledVertices": sampled,
        "invalidVertices": invalid,
        "testedBones": sorted(rotations),
        "passed": True,
    }


def run(input_path, output_path, metadata_path):
    started = time.perf_counter()
    run_id = uuid.uuid4().hex
    input_sha256 = sha256_file(input_path)

    target_meshes = import_original_fresh(input_path)
    armature, schema_build = create_fresh_schema_armature()
    landmark_fit = fit_fresh_armature_to_mesh(armature, target_meshes)

    report = v15.v11.ensure_extended_bones_v11(armature, target_meshes)
    hand_fit = v15.fit_fingers_to_target_mesh(armature, target_meshes, report)
    for side in ("l", "r"):
        if side in hand_fit:
            hand_fit[side]["method"] = HAND_METHOD
    report["handFit"] = hand_fit
    report["landmarkFit"] = landmark_fit
    report["geometry"] = v15.v11.validate_geometry_v11(armature, report, roundtrip=False)

    automatic_weights = v15.bind_geometry_aware_weights(target_meshes, armature)
    finger_weighted, ear_weighted, fallback = v15.v11.v5.legacy.assign_extended_weights(
        armature, target_meshes, report
    )
    clean_weights = cleanup_weights_max_four(target_meshes)
    pose_validation = articulation_smoke_test(armature, target_meshes)

    profile = v15.v11.validate_profile_v11(
        armature, report, finger_weighted, ear_weighted, fallback
    )
    profile["version"] = VERSION
    profile["schemaBuild"] = schema_build
    profile["sourceCleanup"] = dict(_IMPORT_REPORT)
    profile["weights"] = {
        **automatic_weights,
        **clean_weights,
        "automaticMethod": automatic_weights.get("method"),
    }
    profile["landmarkFit"] = landmark_fit
    profile["headFit"] = landmark_fit.get("head")
    profile["handFit"] = hand_fit
    profile["poseValidation"] = pose_validation
    profile["rigSource"] = "Blender fresh CLOUVA schema"
    profile["inputSource"] = "original-clean-meshy-avatar"
    profile["runId"] = run_id
    profile["rigVersionId"] = f"rig-{run_id}"
    profile["inputSha256"] = input_sha256
    profile["schemaSha256"] = schema_build["schemaSha256"]
    profile["boneCount"] = len(armature.data.bones)
    profile["complete"] = bool(
        profile.get("complete")
        and profile.get("fingers", {}).get("complete")
        and profile.get("ears", {}).get("complete")
        and clean_weights.get("weightedRatio", 0.0) >= 0.995
        and landmark_fit.get("method") == RIG_METHOD
        and landmark_fit.get("head", {}).get("method") == "mesh-neck-section-to-crown-v16"
        and hand_fit.get("l", {}).get("method") == HAND_METHOD
        and hand_fit.get("r", {}).get("method") == HAND_METHOD
        and schema_build.get("reusedArmature") is False
        and schema_build.get("bonesCreated") == 24
        and pose_validation.get("passed") is True
    )

    v15.validate_unit_scale(armature, target_meshes)
    if not profile["complete"]:
        raise RuntimeError(f"Blender AutoRig V16 validation failed: {profile}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in target_meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_all_influences=False,
        export_animations=False,
        export_apply=False,
    )
    if not output_path.is_file() or output_path.stat().st_size < 1024:
        raise RuntimeError("Blender did not generate a valid rigged GLB")

    profile["outputSha256"] = sha256_file(output_path)
    profile["durationMs"] = max(1, int((time.perf_counter() - started) * 1000))
    if profile["inputSha256"] == profile["outputSha256"]:
        raise RuntimeError("Blender returned the original file instead of a fresh rig")
    metadata_path.write_text(json.dumps(profile, separators=(",", ":")), encoding="utf-8")
    print(f"[clouva-fresh-schema-autorig-v16] {json.dumps(profile, separators=(',', ':'))}", flush=True)
    return profile


def main():
    args = args_after_separator()
    if len(args) < 3:
        raise RuntimeError("Usage: autorig_avatar_v16.py input.glb output.glb metadata.json")
    input_path, output_path, metadata_path = map(lambda value: Path(value).resolve(), args[:3])
    if not input_path.is_file():
        raise RuntimeError("Original clean avatar GLB not found")
    run(input_path, output_path, metadata_path)


if __name__ == "__main__":
    main()
