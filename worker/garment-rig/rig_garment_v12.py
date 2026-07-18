import importlib.util
import json
import math
import os
import sys
import tempfile


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v11.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V11 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v11", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V11")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
v10 = previous.previous
v9 = previous.v9
legacy = previous.legacy
base_export_glb = v10._original_export_glb


def vector_payload(vector):
    return [float(vector.x), float(vector.y), float(vector.z)]


def parse_vector_property(garment, key):
    raw = garment.get(key)
    try:
        values = json.loads(str(raw))
        if not isinstance(values, list) or len(values) != 3:
            raise ValueError
        result = tuple(float(value) for value in values)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"El GLB perdió la propiedad espacial {key}") from exc
    if not all(math.isfinite(value) for value in result):
        raise RuntimeError(f"La propiedad espacial {key} contiene valores inválidos")
    return result


def relative_error(actual, expected):
    return abs(actual - expected) / max(abs(expected), 1e-8)


def attach_armature_v12(garment, armature):
    """Use the Armature modifier without parenting through a scaled armature object."""
    for modifier in list(garment.modifiers):
        if modifier.type == "ARMATURE":
            garment.modifiers.remove(modifier)

    world = garment.matrix_world.copy()
    garment.parent = None
    garment.matrix_parent_inverse.identity()
    garment.matrix_world = world

    modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = False
    legacy.bpy.context.view_layer.update()

    if garment.parent is not None:
        raise RuntimeError("La prenda siguió parentada al armature después de neutralizar transforms")
    if garment.find_armature() != armature:
        raise RuntimeError("La prenda perdió el modificador del armature oficial")

    garment["clouvaExportBinding"] = "armature_modifier_world_space"
    print(
        "[rig-v12] armature attached without object parenting "
        f"armatureScale={tuple(round(float(value), 6) for value in armature.scale)}",
        flush=True,
    )


legacy.attach_armature = attach_armature_v12


def export_glb_v12(output_path, garment, armature):
    minimum, maximum = legacy.bbox_world(garment)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5

    garment["clouvaRigVersion"] = 12
    garment["clouvaExportSpaceValidation"] = True
    garment["clouvaPreExportSize"] = json.dumps(vector_payload(size), separators=(",", ":"))
    garment["clouvaPreExportCenter"] = json.dumps(vector_payload(center), separators=(",", ":"))

    if min(size) <= 1e-8:
        raise RuntimeError(f"La prenda tiene dimensiones inválidas antes de exportar: {tuple(size)}")

    base_export_glb(output_path, garment, armature)


legacy.export_glb = export_glb_v12


def validate_roundtrip_v12(output_path):
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("El GLB exportado está vacío")

    with tempfile.TemporaryDirectory(prefix="clouva-validate-v12-"):
        legacy.clear_scene()
        imported = legacy.import_glb(output_path)
        armatures = [obj for obj in imported if obj.type == "ARMATURE"]
        skinned = [obj for obj in imported if obj.type == "MESH" and obj.find_armature()]
        if len(armatures) != 1 or not skinned:
            raise RuntimeError("El GLB exportado no contiene un único rig vestible")

        armature = armatures[0]
        garment = max(skinned, key=lambda obj: len(obj.data.vertices))
        if int(garment.get("clouvaRigVersion", 0)) != 12:
            raise RuntimeError("El GLB perdió la metadata de validación CLOUVA V12")
        if garment.find_armature() != armature:
            raise RuntimeError("La prenda reabierta no está vinculada al armature exportado")

        expected_size = parse_vector_property(garment, "clouvaPreExportSize")
        expected_center = parse_vector_property(garment, "clouvaPreExportCenter")
        minimum, maximum = legacy.bbox_world(garment)
        actual_size_vector = maximum - minimum
        actual_center_vector = (minimum + maximum) * 0.5
        actual_size = vector_payload(actual_size_vector)
        actual_center = vector_payload(actual_center_vector)

        size_errors = [relative_error(actual_size[index], expected_size[index]) for index in range(3)]
        center_scale = max(max(abs(value) for value in expected_size), 1e-6)
        center_errors = [abs(actual_center[index] - expected_center[index]) / center_scale for index in range(3)]

        if max(size_errors) > 0.08:
            raise RuntimeError(
                "El GLB cambió la escala de la prenda al exportar: "
                f"esperado={tuple(round(value, 6) for value in expected_size)}, "
                f"obtenido={tuple(round(value, 6) for value in actual_size)}, "
                f"errores={tuple(round(value, 4) for value in size_errors)}"
            )
        if max(center_errors) > 0.08:
            raise RuntimeError(
                "El GLB desplazó la prenda respecto del esqueleto al exportar: "
                f"esperado={tuple(round(value, 6) for value in expected_center)}, "
                f"obtenido={tuple(round(value, 6) for value in actual_center)}, "
                f"errores={tuple(round(value, 4) for value in center_errors)}"
            )

        category = str(garment.get("clouvaCategory", ""))
        if category in legacy.LOWER_GARMENTS:
            marks = legacy.lower_landmarks(armature)
            waist_z = marks["waist"].z
            feet_z = min(marks["left_foot"].z, marks["right_foot"].z)
            leg_length = max(waist_z - feet_z, 1e-8)
            garment_height_ratio = actual_size_vector.z / leg_length
            garment_top_error = abs(maximum.z - (waist_z + leg_length * 0.025)) / leg_length
            if not 0.25 <= garment_height_ratio <= 1.35:
                raise RuntimeError(
                    "El pantalón quedó desproporcionado respecto del esqueleto exportado: "
                    f"heightRatio={garment_height_ratio:.3f}"
                )
            if garment_top_error > 0.12:
                raise RuntimeError(
                    "La cintura se desplazó durante la exportación: "
                    f"error={garment_top_error:.3f}"
                )

        print(
            "[rig-v12] roundtrip spatial contract passed "
            f"sizeErrors={tuple(round(value, 5) for value in size_errors)} "
            f"centerErrors={tuple(round(value, 5) for value in center_errors)}",
            flush=True,
        )


v9.validate_roundtrip_v9 = validate_roundtrip_v12


if __name__ == "__main__":
    v9.main()
