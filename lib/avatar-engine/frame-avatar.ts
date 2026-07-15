import { Box3, MathUtils, Mesh, Object3D, PerspectiveCamera, Vector3 } from "three";

export type AvatarFrameResult = {
  center: Vector3;
  size: Vector3;
  distance: number;
};

function mainBodyBox(object: Object3D): Box3 {
  const meshEntries: { mesh: Mesh; box: Box3; vertexCount: number }[] = [];
  object.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      const geometry = mesh.geometry;
      const vertexCount = geometry?.attributes?.position?.count ?? 0;
      if (vertexCount < 8) return;
      const box = new Box3().setFromObject(mesh);
      if (box.isEmpty()) return;
      meshEntries.push({ mesh, box, vertexCount });
    }
  });

  if (meshEntries.length === 0) return new Box3().setFromObject(object);

  const totalVertices = meshEntries.reduce((sum, entry) => sum + entry.vertexCount, 0);
  meshEntries.sort((a, b) => b.vertexCount - a.vertexCount);
  const mainBox = new Box3();
  let accumulated = 0;
  for (const entry of meshEntries) {
    if (accumulated >= totalVertices * 0.9 && accumulated > 0) break;
    mainBox.union(entry.box);
    accumulated += entry.vertexCount;
  }
  return mainBox.isEmpty() ? new Box3().setFromObject(object) : mainBox;
}

export function normalizeAvatarObject(
  object: Object3D,
  options: { targetHeight?: number; frontRotationY?: number } = {},
) {
  const targetHeight = options.targetHeight ?? 2.05;
  object.rotation.y = options.frontRotationY ?? 0;
  object.updateMatrixWorld(true);

  const initialBox = mainBodyBox(object);
  const initialSize = initialBox.getSize(new Vector3());
  if (initialSize.y > 0.0001) object.scale.multiplyScalar(targetHeight / initialSize.y);

  object.updateMatrixWorld(true);
  const box = mainBodyBox(object);
  const center = box.getCenter(new Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}

export function frameAvatar(
  camera: PerspectiveCamera,
  object: Object3D,
  aspect: number,
  padding = 1.18,
): AvatarFrameResult {
  object.updateMatrixWorld(true);
  const box = mainBodyBox(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const safeAspect = Math.max(aspect, 0.1);
  const verticalFov = MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const distance = Math.max(
    size.y / (2 * Math.tan(verticalFov / 2)),
    size.x / (2 * Math.tan(horizontalFov / 2)),
    size.z * 2,
    2.2,
  ) * padding;

  camera.aspect = safeAspect;
  camera.near = Math.max(distance / 120, 0.02);
  camera.far = Math.max(distance * 20, 100);
  camera.position.set(center.x, center.y + size.y * 0.02, center.z + distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  return { center, size, distance };
}

export type BodyPartMatch = { meshName: string; box: Box3; object: Object3D };

export function findAvatarBodyPart(avatarObject: Object3D, meshNames: string[]): BodyPartMatch | null {
  const result: { match: { mesh: Object3D; box: Box3 } | null } = { match: null };
  avatarObject.updateMatrixWorld(true);
  avatarObject.traverse((child) => {
    if (result.match) return;
    if (meshNames.includes(child.name)) {
      const box = new Box3().setFromObject(child);
      if (!box.isEmpty()) result.match = { mesh: child, box };
    }
  });
  return result.match
    ? { meshName: result.match.mesh.name, box: result.match.box, object: result.match.mesh }
    : null;
}

export type WearableCategory = "hoodie" | "shirt" | "jacket" | "pants" | "shorts" | "shoes" | "accessory";

/**
 * Devuelve una zona corporal estable basada en proporciones del avatar completo.
 * No confía en nombres de mallas porque algunos GLB agrupan cabeza, torso y brazos
 * en una sola malla y eso hacía que el cuello del buzo terminara sobre la cara.
 */
export function inferAvatarBodyPartBox(avatarObject: Object3D, category: WearableCategory): Box3 {
  avatarObject.updateMatrixWorld(true);
  const full = mainBodyBox(avatarObject);
  const size = full.getSize(new Vector3());
  const center = full.getCenter(new Vector3());

  const make = (width: number, yMin: number, yMax: number, depth: number) => {
    const halfW = size.x * width * 0.5;
    const halfD = size.z * depth * 0.5;
    return new Box3(
      new Vector3(center.x - halfW, full.min.y + size.y * yMin, center.z - halfD),
      new Vector3(center.x + halfW, full.min.y + size.y * yMax, center.z + halfD),
    );
  };

  switch (category) {
    case "hoodie": return make(0.82, 0.39, 0.74, 0.70);
    case "shirt": return make(0.76, 0.43, 0.70, 0.66);
    case "jacket": return make(0.86, 0.38, 0.76, 0.74);
    case "pants": return make(0.56, 0.07, 0.52, 0.58);
    case "shorts": return make(0.56, 0.29, 0.52, 0.58);
    case "shoes": return make(0.60, 0.00, 0.12, 0.88);
    default: return make(0.42, 0.44, 0.70, 0.50);
  }
}

export type GarmentFitOptions = {
  paddingScale?: number;
  widthPadding?: number;
  depthPadding?: number;
  verticalOffset?: number;
};

/**
 * Ajusta una prenda conservando sus proporciones originales. Antes se aplicaba
 * una escala distinta en X/Y/Z; eso convertía una hoodie de Meshy en una forma
 * inflada y elevaba hombros/cuello. Ahora se usa una sola escala, se limita el
 * tamaño máximo y se ancla la parte superior al torso.
 */
export function fitGarmentToBodyPart(
  garment: Object3D,
  bodyPartBox: Box3,
  options: GarmentFitOptions = {},
) {
  garment.updateMatrixWorld(true);
  const garmentBox = mainBodyBox(garment);
  const garmentSize = garmentBox.getSize(new Vector3());
  const bodySize = bodyPartBox.getSize(new Vector3());

  if (garmentSize.x < 0.0001 || garmentSize.y < 0.0001 || garmentSize.z < 0.0001) return;

  const padding = options.paddingScale ?? 1;
  const desiredX = bodySize.x * (options.widthPadding ?? 1.06) * padding;
  const desiredY = bodySize.y * padding;
  const desiredZ = bodySize.z * (options.depthPadding ?? 1.08) * padding;

  const scaleX = desiredX / garmentSize.x;
  const scaleY = desiredY / garmentSize.y;
  const scaleZ = desiredZ / garmentSize.z;

  // La menor escala evita que una dimensión defectuosa de Meshy infle las otras.
  const uniformScale = Math.min(scaleX, scaleY, scaleZ);
  garment.scale.multiplyScalar(uniformScale);
  garment.updateMatrixWorld(true);

  const fittedBox = mainBodyBox(garment);
  const fittedSize = fittedBox.getSize(new Vector3());
  const fittedCenter = fittedBox.getCenter(new Vector3());
  const bodyCenter = bodyPartBox.getCenter(new Vector3());

  const targetCenter = bodyCenter.clone();
  // Prendas del torso se alinean por arriba para que el cuello quede debajo de la cabeza.
  targetCenter.y = bodyPartBox.max.y - fittedSize.y * 0.5 + (options.verticalOffset ?? 0);

  garment.position.x += targetCenter.x - fittedCenter.x;
  garment.position.y += targetCenter.y - fittedCenter.y;
  garment.position.z += targetCenter.z - fittedCenter.z;
  garment.updateMatrixWorld(true);
}
