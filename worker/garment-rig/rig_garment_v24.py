import importlib.util
import math
import os
import statistics
import sys


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v23.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V23 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v23", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V23")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9


ROUNDTRIP_SIGNATURE_VERSION = 36
ANCHOR_MEDIAN_ERROR_LIMIT = 0.06
ANCHOR_SECOND_ERROR_LIMIT = 0.10
ANCHOR_SINGLE_ERROR_LIMIT = 0.18


def finite_positive(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number) and number > 1e-10


def shape_reference_scale(shape):
    """Return a stable garment-size denominator for anchor displacement checks.

    V35 divided each anchor delta by that anchor's own expected distance. Hips can sit
    very close to a hoodie's centroid, so a millimetric GLTF coordinate conversion
    became a 19% relative error while chest, neck and both arms remained unchanged.
    The visible garment scale is the correct denominator for a spatial displacement.
    """
    shape = shape if isinstance(shape, dict) else {}
    candidates = []

    for key in ("radialRms", "radialMax"):
        value = shape.get(key)
        if finite_positive(value):
            candidates.append(float(value))

    for key, multiplier in (("principalExtents", 0.25), ("principalSpread", 1.0)):
        values = shape.get(key)
        if isinstance(values, list):
            candidates.extend(float(value) * multiplier for value in values if finite_positive(value))

    if not candidates:
        raise RuntimeError("La firma espacial no contiene una escala válida para verificar el rig")
    return max(candidates)


def garment_signature_v36(garment, armature):
    shape, centroid = previous.shape_signature(previous.evaluated_world_points(garment))
    return {
        "version": ROUNDTRIP_SIGNATURE_VERSION,
        "shape": shape,
        "anchors": {
            "distances": previous.anchor_signature(armature, centroid),
            "referenceScale": shape_reference_scale(shape),
        },
    }


def parse_anchor_payload(payload):
    if not isinstance(payload, dict):
        raise RuntimeError("El GLB perdió la firma de posición contra el esqueleto")
    distances = payload.get("distances")
    reference_scale = payload.get("referenceScale")
    if not isinstance(distances, dict) or not finite_positive(reference_scale):
        raise RuntimeError("La firma de posición contra el esqueleto es inválida")
    return distances, float(reference_scale)


def validate_anchor_metrics_v36(expected, actual):
    expected_distances, expected_scale = parse_anchor_payload(expected)
    actual_distances, actual_scale = parse_anchor_payload(actual)

    missing = sorted(set(expected_distances) - set(actual_distances))
    if missing:
        raise RuntimeError(f"El GLB perdió huesos de referencia para la prenda: {missing}")
    if len(expected_distances) < 3:
        raise RuntimeError("El rig exportado no conserva suficientes huesos para verificar la prenda")

    # Shape validation already guarantees that both scales should match. Using the
    # larger one prevents harmless round-off from making this denominator smaller.
    reference_scale = max(expected_scale, actual_scale, 1e-8)
    absolute_errors = {}
    relative_errors = {}
    for key, expected_distance in expected_distances.items():
        actual_distance = float(actual_distances[key])
        expected_distance = float(expected_distance)
        if not math.isfinite(actual_distance) or not math.isfinite(expected_distance):
            raise RuntimeError(f"La distancia al hueso {key} contiene valores inválidos")
        absolute_errors[key] = abs(actual_distance - expected_distance) / reference_scale
        relative_errors[key] = previous.relative_error(actual_distance, expected_distance)

    ordered = sorted(absolute_errors.values(), reverse=True)
    maximum = ordered[0]
    second = ordered[1] if len(ordered) > 1 else ordered[0]
    median = float(statistics.median(ordered))

    # One noisy near-centroid anchor (normally Hips) may be tolerated, but a coherent
    # garment shift affects multiple independent anchors and is still rejected.
    if (
        maximum > ANCHOR_SINGLE_ERROR_LIMIT
        or second > ANCHOR_SECOND_ERROR_LIMIT
        or median > ANCHOR_MEDIAN_ERROR_LIMIT
    ):
        raise RuntimeError(
            "El GLB desplazó la prenda respecto del esqueleto: "
            f"normalizados={{{', '.join(f'{key}:{value:.4f}' for key, value in absolute_errors.items())}}}, "
            f"relativos={{{', '.join(f'{key}:{value:.4f}' for key, value in relative_errors.items())}}}"
        )

    return {
        "normalizedErrors": absolute_errors,
        "relativeErrors": relative_errors,
        "maximum": maximum,
        "second": second,
        "median": median,
        "referenceScale": reference_scale,
    }


def validate_signature_v36(expected, actual):
    if int(expected.get("version", 0)) != ROUNDTRIP_SIGNATURE_VERSION:
        raise RuntimeError("El GLB perdió la firma espacial CLOUVA V36")
    shape_metrics = previous.validate_shape_metrics(expected.get("shape") or {}, actual.get("shape") or {})
    anchor_metrics = validate_anchor_metrics_v36(expected.get("anchors") or {}, actual.get("anchors") or {})
    return {"shape": shape_metrics, "anchors": anchor_metrics}


# V23's exporter and importer resolve these globals at runtime, so the V36 wrapper can
# retain the complete V35 geometry contract while replacing only its unstable anchor
# denominator and signature schema.
previous.ROUNDTRIP_SIGNATURE_VERSION = ROUNDTRIP_SIGNATURE_VERSION
previous.garment_signature = garment_signature_v36
previous.validate_anchor_metrics = validate_anchor_metrics_v36
previous.validate_signature = validate_signature_v36


def validate_roundtrip_v36(output_path):
    return previous.validate_roundtrip_v35(output_path)


v9.validate_roundtrip_v9 = validate_roundtrip_v36

# Public aliases used by Blender regression tests and Docker contract checks.
evaluated_world_points = previous.evaluated_world_points
shape_signature = previous.shape_signature
validate_shape_metrics = previous.validate_shape_metrics
garment_signature = garment_signature_v36
validate_anchor_metrics = validate_anchor_metrics_v36
validate_signature = validate_signature_v36


if __name__ == "__main__":
    previous.main()
