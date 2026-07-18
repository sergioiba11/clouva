import importlib.util
import math
import os
import sys

from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v12.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V12 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v12", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V12")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9
_original_resolve_bone = legacy.resolve_bone
_LOWER_KEYS = {
    "left_up_leg", "right_up_leg", "left_leg", "right_leg",
    "left_foot", "right_foot", "left_toe", "right_toe",
}
_lower_mapping_cache = {}


def rest_world(armature, data_bone, point="head"):
    if data_bone is None:
        return None
    if point == "tail":
        local = data_bone.tail_local
    elif point == "center":
        local = (data_bone.head_local + data_bone.tail_local) * 0.5
    else:
        local = data_bone.head_local
    return armature.matrix_world @ local


def descendants_with_depth(root, max_depth=6):
    queue = [(child, 1) for child in root.children]
    result = []
    while queue:
        bone, depth = queue.pop(0)
        result.append((bone, depth))
        if depth < max_depth:
            queue.extend((child, depth + 1) for child in bone.children)
    return result


def side_matches(cleaned, side):
    word = "left" if side == "left" else "right"
    letter = "l" if side == "left" else "r"
    return (
        word in cleaned
        or cleaned.startswith(letter)
        or cleaned.endswith(letter)
        or f"{letter}leg" in cleaned
        or f"{letter}thigh" in cleaned
        or f"{letter}foot" in cleaned
    )


def role_score(cleaned, role):
    if role == "upper":
        if any(token in cleaned for token in ("arm", "hand", "foot", "toe", "calf", "shin", "lowerleg")):
            return -100
        if "thigh" in cleaned or "upleg" in cleaned or "upperleg" in cleaned:
            return 45
        if "leg" in cleaned:
            return 12
    elif role == "lower":
        if any(token in cleaned for token in ("arm", "hand", "foot", "toe", "thigh", "upleg", "upperleg")):
            return -100
        if "shin" in cleaned or "calf" in cleaned or "lowerleg" in cleaned:
            return 45
        if "leg" in cleaned:
            return 18
    elif role == "foot":
        if "toe" in cleaned or any(token in cleaned for token in ("arm", "hand", "thigh", "calf", "shin")):
            return -100
        if "foot" in cleaned or "ankle" in cleaned:
            return 45
    elif role == "toe":
        if "toe" in cleaned or "ball" in cleaned:
            return 45
    return -100


def exact_aliases(canonical):
    return {legacy.clean_bone_name(name) for name in legacy.BONE_ALIASES.get(canonical, [])}


def candidate_score(armature, bone, depth, canonical, side, role, hips_world):
    cleaned = legacy.clean_bone_name(bone.name)
    role_points = role_score(cleaned, role)
    if role_points < 0:
        return None

    score = role_points + max(0, 32 - depth * 5)
    if cleaned in exact_aliases(canonical):
        score += 120
    if side_matches(cleaned, side):
        score += 35
    elif role in {"upper", "lower", "foot", "toe"}:
        # Algunos rigs no incluyen L/R en el nombre. En ese caso usamos la posición X.
        world = rest_world(armature, bone, "head")
        if world is not None:
            if side == "left" and world.x < hips_world.x:
                score += 8
            elif side == "right" and world.x > hips_world.x:
                score += 8
            else:
                score -= 12

    head = rest_world(armature, bone, "head")
    tail = rest_world(armature, bone, "tail")
    if head is not None and tail is not None and tail.z < head.z:
        score += 10
    return score


def choose_descendant(armature, root, canonical, side, role, hips_world, exclude=None):
    exclude = exclude or set()
    candidates = []
    for bone, depth in descendants_with_depth(root):
        if bone.name in exclude:
            continue
        score = candidate_score(armature, bone, depth, canonical, side, role, hips_world)
        if score is not None:
            candidates.append((score, -depth, bone))
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item[0], item[1]))[2]


def build_lower_mapping(armature):
    cache_key = int(armature.as_pointer())
    cached = _lower_mapping_cache.get(cache_key)
    if cached is not None:
        return cached

    hips_pose = _original_resolve_bone(armature, "hips")
    hips_data = armature.data.bones.get(hips_pose.name) if hips_pose is not None else None
    if hips_data is None:
        raise RuntimeError("No se pudo resolver Hips en el esqueleto de reposo")
    hips_world = rest_world(armature, hips_data, "center")

    left_up = choose_descendant(armature, hips_data, "left_up_leg", "left", "upper", hips_world)
    right_up = choose_descendant(
        armature,
        hips_data,
        "right_up_leg",
        "right",
        "upper",
        hips_world,
        exclude={left_up.name} if left_up else set(),
    )
    if left_up is None or right_up is None or left_up.name == right_up.name:
        raise RuntimeError("No se pudieron resolver dos muslos distintos debajo de Hips")

    left_leg = choose_descendant(armature, left_up, "left_leg", "left", "lower", hips_world)
    right_leg = choose_descendant(armature, right_up, "right_leg", "right", "lower", hips_world)
    if left_leg is None or right_leg is None:
        raise RuntimeError("No se pudieron resolver las rodillas como descendientes de los muslos")

    left_foot = choose_descendant(armature, left_leg, "left_foot", "left", "foot", hips_world)
    right_foot = choose_descendant(armature, right_leg, "right_foot", "right", "foot", hips_world)
    if left_foot is None or right_foot is None:
        raise RuntimeError("No se pudieron resolver los pies como descendientes de las piernas")

    left_toe = choose_descendant(armature, left_foot, "left_toe", "left", "toe", hips_world)
    right_toe = choose_descendant(armature, right_foot, "right_toe", "right", "toe", hips_world)

    mapping = {
        "hips": hips_data,
        "left_up_leg": left_up,
        "right_up_leg": right_up,
        "left_leg": left_leg,
        "right_leg": right_leg,
        "left_foot": left_foot,
        "right_foot": right_foot,
        "left_toe": left_toe,
        "right_toe": right_toe,
    }
    _lower_mapping_cache[cache_key] = mapping
    return mapping


def resolve_bone_v13(armature, canonical):
    if canonical not in _LOWER_KEYS:
        return _original_resolve_bone(armature, canonical)
    data_bone = build_lower_mapping(armature).get(canonical)
    return armature.pose.bones.get(data_bone.name) if data_bone is not None else None


legacy.resolve_bone = resolve_bone_v13


def lower_landmarks_v13(armature):
    mapping = build_lower_mapping(armature)
    hips = rest_world(armature, mapping["hips"], "center")
    left_up = rest_world(armature, mapping["left_up_leg"], "head")
    right_up = rest_world(armature, mapping["right_up_leg"], "head")
    left_knee = rest_world(armature, mapping["left_leg"], "head")
    right_knee = rest_world(armature, mapping["right_leg"], "head")
    left_foot = rest_world(armature, mapping["left_foot"], "head")
    right_foot = rest_world(armature, mapping["right_foot"], "head")

    values = [hips, left_up, right_up, left_knee, right_knee, left_foot, right_foot]
    if any(value is None or not all(math.isfinite(component) for component in value) for value in values):
        raise RuntimeError("Los landmarks inferiores de REST pose contienen valores inválidos")

    # La cintura pertenece a Hips. Los muslos sirven para ancho/lado, nunca para elevar Z.
    waist = Vector((
        (left_up.x + right_up.x + hips.x) / 3.0,
        (left_up.y + right_up.y + hips.y) / 3.0,
        hips.z,
    ))
    left_length = waist.z - left_foot.z
    right_length = waist.z - right_foot.z
    leg_length = (left_length + right_length) * 0.5
    if leg_length <= 1e-5:
        raise RuntimeError(f"La longitud cintura-pies es inválida: {leg_length:.6f}")

    tolerance = leg_length * 0.10
    if not (waist.z + tolerance >= left_up.z > left_knee.z > left_foot.z - tolerance):
        raise RuntimeError("La jerarquía espacial de la pierna izquierda no es válida en REST pose")
    if not (waist.z + tolerance >= right_up.z > right_knee.z > right_foot.z - tolerance):
        raise RuntimeError("La jerarquía espacial de la pierna derecha no es válida en REST pose")
    if abs(left_up.z - waist.z) > leg_length * 0.30 or abs(right_up.z - waist.z) > leg_length * 0.30:
        raise RuntimeError("Un muslo quedó demasiado lejos de Hips y fue rechazado")
    if max(left_length, right_length) / max(min(left_length, right_length), 1e-8) > 1.35:
        raise RuntimeError("Las longitudes de las piernas del avatar son incompatibles")

    names = {key: bone.name if bone is not None else None for key, bone in mapping.items()}
    print(
        "[rig-v13] REST lower landmarks "
        f"bones={names} hips={tuple(round(float(v), 6) for v in hips)} "
        f"leftUp={tuple(round(float(v), 6) for v in left_up)} "
        f"rightUp={tuple(round(float(v), 6) for v in right_up)} "
        f"leftKnee={tuple(round(float(v), 6) for v in left_knee)} "
        f"rightKnee={tuple(round(float(v), 6) for v in right_knee)} "
        f"leftFoot={tuple(round(float(v), 6) for v in left_foot)} "
        f"rightFoot={tuple(round(float(v), 6) for v in right_foot)} "
        f"legLength={leg_length:.6f}",
        flush=True,
    )

    return {
        "hips": hips,
        "waist": waist,
        "left_up": left_up,
        "right_up": right_up,
        "left_knee": left_knee,
        "right_knee": right_knee,
        "left_foot": left_foot,
        "right_foot": right_foot,
    }


legacy.lower_landmarks = lower_landmarks_v13


_export_v12 = legacy.export_glb


def export_glb_v13(output_path, garment, armature):
    garment["clouvaRestLowerLandmarks"] = True
    garment["clouvaLowerLandmarkVersion"] = 13
    _export_v12(output_path, garment, armature)


legacy.export_glb = export_glb_v13


if __name__ == "__main__":
    v9.main()
