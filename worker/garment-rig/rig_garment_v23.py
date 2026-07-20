import importlib.util
import json
import math
import os
import sys
import tempfile

import numpy as np


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v22.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V22 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v22", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V22")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9
_original_export_glb = legacy.export_glb
_original_roundtrip_validator = v9.validate_roundtrip_v9


ROUNDTRIP_SIGNATURE_VERSION = 35
SHAPE_ERROR_LIMIT = 0.08
ANCHOR_ERROR_LIMIT = 0.10
ANCHOR_KEYS = (
    "hips",
    "chest",
    "neck",
    "left_upper_arm",
    "right_upper_arm",
)


def relative_error(actual, expected):
    actual = float(actual)
    expected = float(expected)
    return abs(actual - expected) / max(abs(expected), 1e-8)


def evaluated_world_points(obj):
    """Return the visible mesh vertices in world space, including the Armature modifier."""
    depsgraph = legacy.bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        if mesh is None or len(mesh.vertices) < 8:
            raise RuntimeError("La prenda no tiene suficientes vértices visibles para validar el GLB")
        matrix = evaluated.matrix_world
        points = np.empty((len(mesh.vertices), 3), dtype=np.float64)
        for index, vertex in enumerate(mesh.vertices):
            world = matrix @ vertex.co
            points[index] = (float(world.x), float(world.y), float(world.z))
    finally:
        evaluated.to_mesh_clear()

    if not np.isfinite(points).all():
        raise RuntimeError("La geometría visible contiene coordenadas no finitas")
    return points


def shape_signature(points):
    """Build a rigid-transform-invariant signature for the visible garment shape.

    The previous V12 contract compared world-axis AABBs. A pure coordinate-system
    rotation during GLB export can enlarge that AABB without scaling or deforming the
    garment. PCA spreads, principal extents and radial quantiles remain unchanged by
    translation or rotation, while still rejecting real non-uniform scaling.
    """
    points = np.asarray(points, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 3 or len(points) < 8:
        raise RuntimeError("No se pudo construir la firma espacial de la prenda")

    centroid = points.mean(axis=0)
    centered = points - centroid
    covariance = centered.T @ centered / max(len(points), 1)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    order = np.argsort(eigenvalues)[::-1]
    eigenvalues = np.maximum(eigenvalues[order], 0.0)
    eigenvectors = eigenvectors[:, order]
    projected = centered @ eigenvectors

    principal_extents = np.max(projected, axis=0) - np.min(projected, axis=0)
    principal_extents = np.sort(np.maximum(principal_extents, 0.0))[::-1]
    principal_spread = np.sqrt(eigenvalues)
    radial = np.linalg.norm(centered, axis=1)
    radial_quantiles = np.quantile(radial, [0.10, 0.25, 0.50, 0.75, 0.90, 0.99])
    radial_rms = math.sqrt(float(np.mean(radial * radial)))

    values = np.concatenate((principal_extents, principal_spread, radial_quantiles, [radial_rms, radial.max()]))
    if not np.isfinite(values).all() or float(values.max()) <= 1e-10:
        raise RuntimeError("La firma espacial de la prenda es inválida")

    return {
        "principalExtents": [float(value) for value in principal_extents],
        "principalSpread": [float(value) for value in principal_spread],
        "radialQuantiles": [float(value) for value in radial_quantiles],
        "radialRms": float(radial_rms),
        "radialMax": float(radial.max()),
    }, centroid


def anchor_signature(armature, centroid):
    anchors = {}
    centroid_vector = legacy.Vector(tuple(float(value) for value in centroid))
    for key in ANCHOR_KEYS:
        point = legacy.bone_center_world(armature, key)
        if point is not None:
            anchors[key] = float((point - centroid_vector).length)
    if len(anchors) < 3:
        raise RuntimeError(
            "El rig exportado no permite validar la posición de la prenda contra suficientes huesos"
        )
    return anchors


def garment_signature(garment, armature):
    shape, centroid = shape_signature(evaluated_world_points(garment))
    return {
        "version": ROUNDTRIP_SIGNATURE_VERSION,
        "shape": shape,
        "anchors": anchor_signature(armature, centroid),
    }


def vector_errors(actual, expected):
    if not isinstance(actual, list) or not isinstance(expected, list) or len(actual) != len(expected):
        raise RuntimeError("La firma espacial del GLB quedó incompleta")
    return [relative_error(actual[index], expected[index]) for index in range(len(expected))]


def validate_shape_metrics(expected, actual):
    extent_errors = vector_errors(actual.get("principalExtents"), expected.get("principalExtents"))
    spread_errors = vector_errors(actual.get("principalSpread"), expected.get("principalSpread"))
    radial_errors = vector_errors(actual.get("radialQuantiles"), expected.get("radialQuantiles"))
    radial_errors.extend([
        relative_error(actual.get("radialRms"), expected.get("radialRms")),
        relative_error(actual.get("radialMax"), expected.get("radialMax")),
    ])

    maximum = max(extent_errors + spread_errors + radial_errors)
    if maximum > SHAPE_ERROR_LIMIT:
        raise RuntimeError(
            "El GLB deformó o escaló la geometría visible de la prenda: "
            f"principal={tuple(round(value, 4) for value in extent_errors)}, "
            f"spread={tuple(round(value, 4) for value in spread_errors)}, "
            f"radialMaxError={max(radial_errors):.4f}"
        )
    return {
        "principalErrors": extent_errors,
        "spreadErrors": spread_errors,
        "radialErrors": radial_errors,
    }


def validate_anchor_metrics(expected, actual):
    if not isinstance(expected, dict) or not isinstance(actual, dict):
        raise RuntimeError("El GLB perdió la firma de posición contra el esqueleto")
    missing = sorted(set(expected) - set(actual))
    if missing:
        raise RuntimeError(f"El GLB perdió huesos de referencia para la prenda: {missing}")

    errors = {
        key: relative_error(actual[key], expected[key])
        for key in expected
    }
    if len(errors) < 3 or max(errors.values()) > ANCHOR_ERROR_LIMIT:
        raise RuntimeError(
            "El GLB desplazó la prenda respecto del esqueleto: "
            f"errores={{{', '.join(f'{key}:{value:.4f}' for key, value in errors.items())}}}"
        )
    return errors


def validate_signature(expected, actual):
    if int(expected.get("version", 0)) != ROUNDTRIP_SIGNATURE_VERSION:
        raise RuntimeError("El GLB perdió la firma espacial CLOUVA V35")
    shape_metrics = validate_shape_metrics(expected.get("shape") or {}, actual.get("shape") or {})
    anchor_metrics = validate_anchor_metrics(expected.get("anchors") or {}, actual.get("anchors") or {})
    return {"shape": shape_metrics, "anchors": anchor_metrics}


def export_glb_v35(output_path, garment, armature):
    signature = garment_signature(garment, armature)
    garment["clouvaStableRoundtripVersion"] = ROUNDTRIP_SIGNATURE_VERSION
    garment["clouvaStableRoundtripSignature"] = json.dumps(signature, separators=(",", ":"))
    _original_export_glb(output_path, garment, armature)


legacy.export_glb = export_glb_v35


def parse_signature(garment):
    raw = garment.get("clouvaStableRoundtripSignature")
    try:
        value = json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError("El GLB perdió la firma espacial CLOUVA V35") from exc
    if not isinstance(value, dict):
        raise RuntimeError("La firma espacial CLOUVA V35 es inválida")
    return value


def validate_roundtrip_v35(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("El GLB exportado está vacío")

    with tempfile.TemporaryDirectory(prefix="clouva-validate-v35-"):
        legacy.clear_scene()
        imported = legacy.import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("El GLB exportado no contiene un único rig vestible")

        armature = armatures[0]
        garment = max(skinned, key=lambda obj: len(obj.data.vertices))
        category = str(garment.get("clouvaCategory", "")).strip().lower()

        # Pants and shorts retain the strict lower-body landmark validator from V15/V16.
        if category in legacy.LOWER_GARMENTS:
            return _original_roundtrip_validator(output_path)

        if garment.find_armature() != armature:
            raise RuntimeError("La prenda reabierta no está vinculada al armature exportado")

        expected = parse_signature(garment)
        actual = garment_signature(garment, armature)
        metrics = validate_signature(expected, actual)
        garment["clouvaStableRoundtripValidated"] = True
        print(
            "[rig-v35] rotation-invariant visible roundtrip passed "
            f"category={category or 'unknown'} metrics={metrics}",
            flush=True,
        )


v9.validate_roundtrip_v9 = validate_roundtrip_v35


if __name__ == "__main__":
    previous.main()
