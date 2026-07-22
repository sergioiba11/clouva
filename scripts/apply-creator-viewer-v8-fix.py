from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: esperaba 1 coincidencia y encontré {count}")
    return text.replace(old, new, 1)


viewer_path = Path("components/creator-studio/CreatorStudioAvatarViewerV6.tsx")
text = viewer_path.read_text(encoding="utf-8")

text = replace_once(text, "  Points,\n  PointsMaterial,\n", "", "imports de puntos")
text = replace_once(
    text,
    "  const visibleJoints = bones.filter((bone) => !isPalmRoot(bone.name) && !isUnsafeHelper(bone.name));\n\n",
    "",
    "joints visibles duplicados",
)
text = replace_once(
    text,
    "  const segmentCapacity = links.length + 1 + ears.length * 2 + fingerTips.length;\n  const linePositions = new Float32Array(Math.max(segmentCapacity * 6, 6));\n  const pointPositions = new Float32Array(Math.max(visibleJoints.length * 3, 3));",
    "  const segmentCapacity = links.length + 1 + ears.length + fingerTips.length;\n  const linePositions = new Float32Array(Math.max(segmentCapacity * 6, 6));",
    "capacidad de líneas",
)

point_setup = re.compile(
    r"\n  const pointGeometry = new BufferGeometry\(\);.*?\n  const group = new Group\(\);\n  group\.add\(lines, points\);",
    re.S,
)
text, count = point_setup.subn("\n  const group = new Group();\n  group.add(lines);", text, count=1)
if count != 1:
    raise RuntimeError(f"setup de puntos: esperaba 1 coincidencia y encontré {count}")

ear_block = re.compile(
    r"    // Las orejas son joints hoja: se muestran como pequeños huesos cruzados en su posición real\..*?\n    // glTF no conserva el tail del último hueso\.",
    re.S,
)
ear_replacement = '''    // Las orejas se dibujan con un único segmento corto hacia afuera, sin cruces flotantes.
    root.getWorldQuaternion(tmpRootWorldQuaternion);
    const right = tmpB.set(1, 0, 0).applyQuaternion(tmpRootWorldQuaternion).normalize().clone();
    box.getCenter(tmpCenter);
    for (const ear of ears) {
      ear.getWorldPosition(tmpA);
      const sign = tmpA.x >= tmpCenter.x ? 1 : -1;
      tmpC.copy(tmpA).addScaledVector(right, sign * height * 0.020);
      lineOffset = writeLine(lineArray, lineOffset, tmpA, tmpC);
    }

    // glTF no conserva el tail del último hueso.'''
text, count = ear_block.subn(ear_replacement, text, count=1)
if count != 1:
    raise RuntimeError(f"bloque de orejas: esperaba 1 coincidencia y encontré {count}")

point_update = re.compile(
    r"\n    const pointAttribute = pointGeometry\.getAttribute\(\"position\"\) as Float32BufferAttribute;.*?\n    pointGeometry\.computeBoundingSphere\(\);",
    re.S,
)
text, count = point_update.subn("", text, count=1)
if count != 1:
    raise RuntimeError(f"actualización de puntos: esperaba 1 coincidencia y encontré {count}")

text = replace_once(
    text,
    "      lineGeometry.dispose();\n      lineMaterial.dispose();\n      pointGeometry.dispose();\n      pointMaterial.dispose();",
    "      lineGeometry.dispose();\n      lineMaterial.dispose();",
    "dispose de puntos",
)

text = replace_once(
    text,
    "    const camera = new PerspectiveCamera(31, 1, 0.02, 100);",
    "    const camera = new PerspectiveCamera(31, 1, 0.005, 100);",
    "near plane",
)
text = replace_once(
    text,
    "    mount.appendChild(renderer.domElement);",
    "    renderer.domElement.style.touchAction = \"none\";\n    mount.appendChild(renderer.domElement);",
    "touch action",
)
text = replace_once(
    text,
    "    const controls = new OrbitControls(camera, renderer.domElement);\n    controls.enableDamping = false;\n    controls.enablePan = false;\n    controls.enableRotate = false;\n    controls.enableZoom = true;\n    controls.minDistance = 1.2;\n    controls.maxDistance = 8;",
    "    const controls = new OrbitControls(camera, renderer.domElement);\n    controls.enableDamping = true;\n    controls.dampingFactor = 0.08;\n    controls.enablePan = true;\n    controls.enableRotate = true;\n    controls.enableZoom = true;\n    controls.screenSpacePanning = true;\n    controls.zoomToCursor = true;\n    controls.minPolarAngle = 0.12;\n    controls.maxPolarAngle = Math.PI - 0.12;\n    controls.minDistance = 0.35;\n    controls.maxDistance = 12;",
    "controles orbit",
)
text = replace_once(
    text,
    "      const framed = frameAvatar(camera, model, aspect, 1.28);\n      controls.target.copy(framed.center);\n      controls.update();\n      controls.saveState();",
    "      const framed = frameAvatar(camera, model, aspect, 1.28);\n      const fittedDistance = Math.max(camera.position.distanceTo(framed.center), 0.1);\n      camera.near = Math.max(0.002, fittedDistance / 1000);\n      camera.far = Math.max(100, fittedDistance * 30);\n      camera.updateProjectionMatrix();\n      controls.target.copy(framed.center);\n      controls.minDistance = Math.max(0.28, fittedDistance * 0.22);\n      controls.maxDistance = Math.max(8, fittedDistance * 4);\n      controls.update();\n      controls.saveState();",
    "refit dinámico",
)
text = replace_once(
    text,
    "    const observer = new ResizeObserver(resize);\n    observer.observe(mount);",
    "    const handleDoubleClick = () => refit();\n    renderer.domElement.addEventListener(\"dblclick\", handleDoubleClick);\n\n    const observer = new ResizeObserver(resize);\n    observer.observe(mount);",
    "doble click reset",
)
text = replace_once(
    text,
    "      observer.disconnect();\n      action?.stop();",
    "      observer.disconnect();\n      renderer.domElement.removeEventListener(\"dblclick\", handleDoubleClick);\n      action?.stop();",
    "cleanup doble click",
)

viewer_path.write_text(text, encoding="utf-8")

Path("components/creator-studio/CreatorStudioAvatarViewerV8.tsx").write_text(
    '''"use client";\n\n// V8 usa una sola escena, una sola cámara y un solo OrbitControls para la malla\n// y el esqueleto. Así nunca se separan al rotar, acercar o desplazar el avatar.\nexport {\n  CreatorStudioAvatarViewer,\n  type AnchorBoneKey,\n  type CreatorPoseMode,\n  type CreatorStudioAvatarContext,\n} from "./CreatorStudioAvatarViewerV6";\n''',
    encoding="utf-8",
)

Path("components/creator-studio/CreatorStudioAvatarViewer.tsx").write_text(
    'export * from "./CreatorStudioAvatarViewerV8";\n',
    encoding="utf-8",
)

Path("tests-creator-viewer-anatomy.mjs").write_text(
    '''import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst viewer = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV6.tsx", "utf8");\nconst entry = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewer.tsx", "utf8");\nconst v8 = fs.readFileSync("components/creator-studio/CreatorStudioAvatarViewerV8.tsx", "utf8");\nconst approval = fs.readFileSync("components/creator-studio/RigApprovalWorkspace.tsx", "utf8");\n\nassert.match(entry, /export \\* from "\\.\\/CreatorStudioAvatarViewerV8"/);\nassert.match(v8, /una sola escena, una sola cámara/);\nassert.match(v8, /from "\\.\\/CreatorStudioAvatarViewerV6"/);\nassert.doesNotMatch(v8, /SkeletonOverlay/);\nassert.doesNotMatch(v8, /BaseViewer/);\n\nassert.match(viewer, /createSkeletonPreview\\(model, rig\\)/);\nassert.match(viewer, /scene\\.add\\(skeletonPreview\\.group\\)/);\nassert.match(viewer, /controls\\.enableRotate = true/);\nassert.match(viewer, /controls\\.enablePan = true/);\nassert.match(viewer, /controls\\.enableZoom = true/);\nassert.match(viewer, /controls\\.screenSpacePanning = true/);\nassert.match(viewer, /controls\\.zoomToCursor = true/);\nassert.match(viewer, /fittedDistance \\/ 1000/);\nassert.match(viewer, /controls\\.minDistance = Math\\.max\\(0\\.28, fittedDistance \\* 0\\.22\\)/);\nassert.match(viewer, /dblclick/);\nassert.match(viewer, /finger\\?\\.segment === 1/);\nassert.match(viewer, /fingerTips/);\nassert.match(viewer, /headEnd/);\nassert.match(viewer, /isEarBone/);\nassert.match(viewer, /sign \\* height \\* 0\\.020/);\nassert.match(viewer, /depthTest: false/);\nassert.doesNotMatch(viewer, /new SkeletonHelper/);\nassert.doesNotMatch(viewer, /PointsMaterial/);\nassert.doesNotMatch(viewer, /huesos cruzados/);\n\nassert.match(approval, /headGeometryOk/);\nassert.match(approval, /fingerGeometryOk/);\nassert.match(approval, /earGeometryOk/);\nassert.match(approval, /followsHand/);\nassert.match(approval, /earSymmetryOk/);\nassert.match(approval, /Rig anatómico incorrecto/);\nassert.match(approval, /&& headPresent/);\nassert.match(approval, /&& fingerGeometryOk/);\nassert.match(approval, /&& earGeometryOk/);\n\nconsole.log("[clouva] Creator Studio V8 keeps model and skeleton on one interactive camera");\n''',
    encoding="utf-8",
)

print("[clouva] Creator Studio V8 single-camera controls patch applied")
