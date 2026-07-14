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

export type BodyPartMatch = { meshName: string; box: Box3 };

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
  return result.match ? { meshName: result.match.mesh.name, box: result.match.box } : null;
}

export type WearableCategory = "hoodie" | "shirt" | "jacket" | "pants" | "shorts" | "shoes" | "accessory";

type WearableFitPreset = {
  width: number;
  height: number;
  depth: number;
  yAnchor: "top" | "center" | "bottom";
  yOffset: number;
  zOffset: number;
};

const WEARABLE_FIT_PRESETS: Record<WearableCategory, WearableFitPreset> = {
  hoodie: { width: 1.12, height: 0.82, depth: 1.16, yAnchor: "top", yOffset: -0.04, zOffset: 0.02 },
  shirt: { width: 1.04, height: 0.66, depth: 1.08, yAnchor: "top", yOffset: -0.02, zOffset: 0.015 },
  jacket: { width: 1.14, height: 0.84, depth: 1.18, yAnchor: "top", yOffset: -0.04, zOffset: 0.025 },
  pants: { width: 1.08, height: 1.0, depth: 1.12, yAnchor: "top", yOffset: 0, zOffset: 0.01 },
  shorts: { width: 1.08, height: 0.52, depth: 1.1, yAnchor: "top", yOffset: 0, zOffset: 0.01 },
  shoes: { width: 1.1, height: 1.0, depth: 1.15, yAnchor: "bottom", yOffset: 0, zOffset: 0.02 },
  accessory: { width: 0.45, height: 0.45, depth: 0.45, yAnchor: "center", yOffset: 0, zOffset: 0.03 },
};

export function fitWearableToBodyPart(
  wearable: Object3D,
  bodyPartBox: Box3,
  category: WearableCategory,
) {
  wearable.rotation.set(0, 0, 0);
  wearable.position.set(0, 0, 0);
  wearable.updateMatrixWorld(true);

  const wearableBox = mainBodyBox(wearable);
  const wearableSize = wearableBox.getSize(new Vector3());
  const bodySize = bodyPartBox.getSize(new Vector3());
  if (wearableSize.x < 0.0001 || wearableSize.y < 0.0001 || wearableSize.z < 0.0001) return;

  const preset = WEARABLE_FIT_PRESETS[category] ?? WEARABLE_FIT_PRESETS.accessory;
  const scaleX = (bodySize.x * preset.width) / wearableSize.x;
  const scaleY = (bodySize.y * preset.height) / wearableSize.y;
  const scaleZ = (bodySize.z * preset.depth) / wearableSize.z;

  // Uniform scaling preserves the generated garment proportions. Using the
  // smallest axis prevents a wide or deep Meshy result from becoming a tent.
  const scale = Math.min(scaleX, scaleY, scaleZ);
  wearable.scale.multiplyScalar(scale);
  wearable.updateMatrixWorld(true);

  const fittedBox = mainBodyBox(wearable);
  const fittedSize = fittedBox.getSize(new Vector3());
  const fittedCenter = fittedBox.getCenter(new Vector3());
  const bodyCenter = bodyPartBox.getCenter(new Vector3());
  const target = bodyCenter.clone();

  if (preset.yAnchor === "top") {
    target.y = bodyPartBox.max.y - fittedSize.y / 2 + bodySize.y * preset.yOffset;
  } else if (preset.yAnchor === "bottom") {
    target.y = bodyPartBox.min.y + fittedSize.y / 2 + bodySize.y * preset.yOffset;
  } else {
    target.y += bodySize.y * preset.yOffset;
  }
  target.z += bodySize.z * preset.zOffset;

  wearable.position.add(target.sub(fittedCenter));
  wearable.updateMatrixWorld(true);
}

// Compatibilidad con llamadas anteriores.
export function fitGarmentToBodyPart(
  garment: Object3D,
  bodyPartBox: Box3,
  options: { paddingScale?: number } = {},
) {
  garment.updateMatrixWorld(true);
  const garmentBox = mainBodyBox(garment);
  const garmentSize = garmentBox.getSize(new Vector3());
  const bodySize = bodyPartBox.getSize(new Vector3());
  if (garmentSize.y < 0.0001) return;
  const scale = (bodySize.y / garmentSize.y) * (options.paddingScale ?? 1.02);
  garment.scale.multiplyScalar(scale);
  garment.updateMatrixWorld(true);
  const rescaledBox = mainBodyBox(garment);
  const rescaledCenter = rescaledBox.getCenter(new Vector3());
  const bodyCenter = bodyPartBox.getCenter(new Vector3());
  garment.position.add(bodyCenter.sub(rescaledCenter));
  garment.updateMatrixWorld(true);
}
