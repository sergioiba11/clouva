import json
import math
import sys
from pathlib import Path

import bpy


CONTRACT_VERSION = "body-contract-v1"
SECTION_RATIOS = {
    "hips": 0.50,
    "waist": 0.57,
    "chest": 0.68,
    "shoulders": 0.76,
}
CATEGORY_CLEARANCE_CM = {
    "hoodie": 5.0,
    "shirt": 2.5,
    "jacket": 6.0,
    "pants": 4.0,
    "shorts": 3.5,
    "shoes": 1.5,
    "accessory": 1.0,
}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_avatar(path: Path) -> None:
    header = path.read_bytes()[:32]
    suffix = path.suffix.lower()
    if header[:4] == b"glTF" or suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif header.startswith(b"Kaydara FBX Binary") or suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    else:
        raise RuntimeError("El archivo del avatar no es un GLB, GLTF o FBX válido")


def world_vertices() -> list[tuple[float, float, float]]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points: list[tuple[float, float, float]] = []
    for source in bpy.context.scene.objects:
        if source.type != "MESH" or source.hide_render:
            continue
        evaluated = source.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            matrix = evaluated.matrix_world
            for vertex in mesh.vertices:
                point = matrix @ vertex.co
                points.append((float(point.x), float(point.y), float(point.z)))
        finally:
            evaluated.to_mesh_clear()
    if not points:
        raise RuntimeError("El avatar no contiene una malla visible para medir")
    return points


def cm_factor(raw_height: float) -> float:
    # Los GLB suelen entrar en metros; algunos FBX de Unreal ya llegan en centímetros.
    return 100.0 if 0.25 <= raw_height <= 4.0 else 1.0


def rounded(value: float) -> float:
    return round(value, 2)


def ellipse_circumference(width: float, depth: float) -> float:
    a = max(width / 2.0, 0.001)
    b = max(depth / 2.0, 0.001)
    return math.pi * (3.0 * (a + b) - math.sqrt((3.0 * a + b) * (a + 3.0 * b)))


def section(points: list[tuple[float, float, float]], target_z: float, band: float, factor: float) -> dict:
    selected = [point for point in points if abs(point[2] - target_z) <= band]
    if len(selected) < 8:
        selected = sorted(points, key=lambda point: abs(point[2] - target_z))[: max(24, min(200, len(points)))]
    xs = [point[0] for point in selected]
    ys = [point[1] for point in selected]
    width = (max(xs) - min(xs)) * factor
    depth = (max(ys) - min(ys)) * factor
    return {
        "zCm": rounded(target_z * factor),
        "widthCm": rounded(width),
        "depthCm": rounded(depth),
        "circumferenceApproxCm": rounded(ellipse_circumference(width, depth)),
        "sampleCount": len(selected),
    }


def build_contract(points: list[tuple[float, float, float]], category: str) -> dict:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    zs = [point[2] for point in points]
    minimum = (min(xs), min(ys), min(zs))
    maximum = (max(xs), max(ys), max(zs))
    raw_height = maximum[2] - minimum[2]
    factor = cm_factor(raw_height)
    height_cm = raw_height * factor
    band = max(raw_height * 0.018, 0.005)

    sections = {
        name: section(points, minimum[2] + raw_height * ratio, band, factor)
        for name, ratio in SECTION_RATIOS.items()
    }

    clearance = CATEGORY_CLEARANCE_CM.get(category, CATEGORY_CLEARANCE_CM["accessory"])
    return {
        "ok": True,
        "version": CONTRACT_VERSION,
        "source": "blender-active-avatar-mesh",
        "units": "centimeters",
        "category": category,
        "heightCm": rounded(height_cm),
        "overallWidthCm": rounded((maximum[0] - minimum[0]) * factor),
        "overallDepthCm": rounded((maximum[1] - minimum[1]) * factor),
        "armSpanCm": rounded((maximum[0] - minimum[0]) * factor),
        "sections": sections,
        "recommendedClearanceCm": clearance,
        "garmentTarget": {
            "chestWidthCm": rounded(sections["chest"]["widthCm"] + clearance * 2.0),
            "chestDepthCm": rounded(sections["chest"]["depthCm"] + clearance * 2.0),
            "waistWidthCm": rounded(sections["waist"]["widthCm"] + clearance * 2.0),
            "hipWidthCm": rounded(sections["hips"]["widthCm"] + clearance * 2.0),
            "shoulderWidthCm": rounded(sections["shoulders"]["widthCm"] + clearance * 2.0),
        },
        "mesh": {
            "vertexSamples": len(points),
            "rawHeight": rounded(raw_height),
            "centimeterFactor": factor,
        },
    }


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) < 2:
        raise RuntimeError("Uso: body_contract.py <avatar.glb|fbx> <output.json> [category]")
    avatar_path = Path(args[0])
    output_path = Path(args[1])
    category = (args[2] if len(args) > 2 else "hoodie").strip().lower()

    reset_scene()
    import_avatar(avatar_path)
    contract = build_contract(world_vertices(), category)
    output_path.write_text(json.dumps(contract, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"CLOUVA_BODY_CONTRACT={json.dumps(contract, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
