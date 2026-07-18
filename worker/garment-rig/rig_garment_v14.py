import importlib.util
import math
import os
import sys

from mathutils import Vector


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v13.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V13 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v13", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V13")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9
_export_v13 = legacy.export_glb


def finite_vector(value):
    return value is not None and all(math.isfinite(component) for component in value)


def lower_landmarks_v14(armature):
    """Resolve lower-body landmarks without assuming a fixed pelvis-to-thigh distance.

    Stylized avatars can have a tall pelvis bone or helper bones between Hips and the
    actual thigh deform bones. The safe contract is therefore hierarchy + role + REST
    pose ordering, not an arbitrary percentage between Hips and the thigh head.
    """
    mapping = previous.build_lower_mapping(armature)
    hips = previous.rest_world(armature, mapping["hips"], "center")
    left_up = previous.rest_world(armature, mapping["left_up_leg"], "head")
    right_up = previous.rest_world(armature, mapping["right_up_leg"], "head")
    left_knee = previous.rest_world(armature, mapping["left_leg"], "head")
    right_knee = previous.rest_world(armature, mapping["right_leg"], "head")
    left_foot = previous.rest_world(armature, mapping["left_foot"], "head")
    right_foot = previous.rest_world(armature, mapping["right_foot"], "head")

    values = [hips, left_up, right_up, left_knee, right_knee, left_foot, right_foot]
    if any(not finite_vector(value) for value in values):
        raise RuntimeError("Los landmarks inferiores de REST pose contienen valores inválidos")

    # La cintura siempre pertenece a Hips. La posición de los muslos solo aporta el
    # ancho y la dirección de cada pierna; nunca modifica la altura objetivo.
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

    left_upper_segment = left_up.z - left_knee.z
    right_upper_segment = right_up.z - right_knee.z
    left_lower_segment = left_knee.z - left_foot.z
    right_lower_segment = right_knee.z - right_foot.z
    minimum_segment = max(leg_length * 0.03, 1e-5)

    if min(left_upper_segment, right_upper_segment) <= minimum_segment:
        raise RuntimeError(
            "Los muslos resueltos no tienen longitud suficiente: "
            f"left={left_upper_segment:.6f}, right={right_upper_segment:.6f}"
        )
    if min(left_lower_segment, right_lower_segment) <= minimum_segment:
        raise RuntimeError(
            "Las piernas inferiores resueltas no tienen longitud suficiente: "
            f"left={left_lower_segment:.6f}, right={right_lower_segment:.6f}"
        )

    if max(left_length, right_length) / max(min(left_length, right_length), 1e-8) > 1.35:
        raise RuntimeError("Las longitudes de las piernas del avatar son incompatibles")

    # Diagnóstico, no rechazo: en avatares chibi o con pelvis alta este valor puede ser
    # mucho mayor a 0.30 y aun así la cadena Hips -> muslo -> rodilla -> pie ser correcta.
    left_hip_drop_ratio = (waist.z - left_up.z) / leg_length
    right_hip_drop_ratio = (waist.z - right_up.z) / leg_length
    left_chain_ratio = (left_upper_segment + left_lower_segment) / leg_length
    right_chain_ratio = (right_upper_segment + right_lower_segment) / leg_length

    names = {key: bone.name if bone is not None else None for key, bone in mapping.items()}
    print(
        "[rig-v14] stylized REST lower landmarks "
        f"bones={names} hips={tuple(round(float(v), 6) for v in hips)} "
        f"leftUp={tuple(round(float(v), 6) for v in left_up)} "
        f"rightUp={tuple(round(float(v), 6) for v in right_up)} "
        f"leftKnee={tuple(round(float(v), 6) for v in left_knee)} "
        f"rightKnee={tuple(round(float(v), 6) for v in right_knee)} "
        f"leftFoot={tuple(round(float(v), 6) for v in left_foot)} "
        f"rightFoot={tuple(round(float(v), 6) for v in right_foot)} "
        f"legLength={leg_length:.6f} "
        f"hipDropRatios=({left_hip_drop_ratio:.4f}, {right_hip_drop_ratio:.4f}) "
        f"chainRatios=({left_chain_ratio:.4f}, {right_chain_ratio:.4f})",
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


legacy.lower_landmarks = lower_landmarks_v14


def export_glb_v14(output_path, garment, armature):
    garment["clouvaRestLowerLandmarks"] = True
    garment["clouvaLowerLandmarkVersion"] = 14
    garment["clouvaStylizedPelvisCompatible"] = True
    _export_v13(output_path, garment, armature)


legacy.export_glb = export_glb_v14


if __name__ == "__main__":
    v9.main()
