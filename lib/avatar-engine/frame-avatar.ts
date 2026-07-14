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
 * Crea una zona corporal estable aunque el GLB no use nombres como
 * Casual_Body/Casual_Legs. Esto es clave para avatares generados por Meshy:
 * usa proporciones del cuerpo completo normalizado, no nombres de malla.
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
    case "hoodie": return make(0.86, 0.43, 0.89, 0.78);
    case "shirt": return make(0.80, 0.48, 0.84, 0.72);
    case "jacket": return make(0.90, 0.42, 0.90, 0.82);
    case "pants": return make(0.58, 0.06, 0.55, 0.62);
    case "shorts": return make(0.58, 0.30, 0.56, 0.62);
    case "shoes": return make(0.62, 0.00, 0.14, 0.92);
    default: return make(0.46, 0.45, 0.78, 0.55);
  }
}

export type GarmentFitOptions = {
  paddingScale?: number;
  widthPadding?: number;
  depthPadding?: number;
  verticalOffset?: number;
};

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

  const uniformPadding = options.paddingScale ?? 1;
  const widthPadding = options.widthPadding ?? 1.08;
  const depthPadding = options.depthPadding ?? 1.12;

  const sx = (bodySize.x / garmentSize.x) * widthPadding * uniformPadding;
  const sy = (bodySize.y / garmentSize.y) * uniformPadding;
  const sz = (bodySize.z / garmentSize.z) * depthPadding * uniformPadding;

  garment.scale.set(
    garment.scale.x * sx,
    garment.scale.y * sy,
    garment.scale.z * sz,
  );

  garment.updateMatrixWorld(true);
  const conformedBox = mainBodyBox(garment);
  const conformedCenter = conformedBox.getCenter(new Vector3());
  const bodyCenter = bodyPartBox.getCenter(new Vector3());

  garment.position.x += bodyCenter.x - conformedCenter.x;
  garment.position.y += bodyCenter.y - conformedCenter.y + (options.verticalOffset ?? 0);
  garment.position.z += bodyCenter.z - conformedCenter.z;
  garment.updateMatrixWorld(true);
}
