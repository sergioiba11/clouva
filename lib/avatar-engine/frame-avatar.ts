import { Bone, Box3, MathUtils, Mesh, Object3D, PerspectiveCamera, Vector3 } from "three";

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

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findBone(avatar: Object3D, hints: string[]): Bone | null {
  const normalizedHints = hints.map(normalizeName);
  let exact: Bone | null = null;
  let partial: Bone | null = null;
  avatar.traverse((child) => {
    if (!(child as Bone).isBone || exact) return;
    const name = normalizeName(child.name);
    for (const hint of normalizedHints) {
      if (name === hint) {
        exact = child as Bone;
        return;
      }
      if (!partial && name.includes(hint)) partial = child as Bone;
    }
  });
  return exact ?? partial;
}

function worldPosition(bone: Bone | null): Vector3 | null {
  return bone ? bone.getWorldPosition(new Vector3()) : null;
}

function skeletonBodyPartBox(avatar: Object3D, category: WearableCategory, full: Box3): Box3 | null {
  const fullSize = full.getSize(new Vector3());
  const fullCenter = full.getCenter(new Vector3());
  const hips = worldPosition(findBone(avatar, ["hips", "pelvis", "mixamorighips"]));
  const chest = worldPosition(findBone(avatar, ["upperchest", "chest", "spine2", "spine02", "spine1"]));
  const neck = worldPosition(findBone(avatar, ["neck", "neck1"]));
  const leftShoulder = worldPosition(findBone(avatar, ["leftshoulder", "shoulderl", "claviclel", "leftclavicle"]));
  const rightShoulder = worldPosition(findBone(avatar, ["rightshoulder", "shoulderr", "clavicler", "rightclavicle"]));
  const leftFoot = worldPosition(findBone(avatar, ["leftfoot", "footl", "leftankle"]));
  const rightFoot = worldPosition(findBone(avatar, ["rightfoot", "footr", "rightankle"]));

  if (category === "hoodie" || category === "shirt" || category === "jacket") {
    if (!hips || (!chest && !neck)) return null;
    const shoulderY = leftShoulder && rightShoulder
      ? (leftShoulder.y + rightShoulder.y) * 0.5
      : (neck?.y ?? chest!.y) - fullSize.y * 0.025;
    const shoulderWidth = leftShoulder && rightShoulder
      ? Math.abs(leftShoulder.x - rightShoulder.x)
      : fullSize.x * 0.43;
    const top = shoulderY + fullSize.y * (category === "jacket" ? 0.035 : 0.02);
    const bottom = hips.y - fullSize.y * (category === "shirt" ? 0.005 : 0.035);
    const widthMultiplier = category === "jacket" ? 1.55 : category === "hoodie" ? 1.48 : 1.36;
    const halfWidth = Math.max(shoulderWidth * widthMultiplier * 0.5, fullSize.x * 0.19);
    const halfDepth = fullSize.z * (category === "jacket" ? 0.31 : category === "hoodie" ? 0.29 : 0.26);
    return new Box3(
      new Vector3(fullCenter.x - halfWidth, Math.min(bottom, top - fullSize.y * 0.2), fullCenter.z - halfDepth),
      new Vector3(fullCenter.x + halfWidth, top, fullCenter.z + halfDepth),
    );
  }

  if (category === "pants" || category === "shorts") {
    if (!hips) return null;
    const bottom = category === "shorts" ? hips.y - fullSize.y * 0.23 : full.min.y + fullSize.y * 0.055;
    const halfWidth = fullSize.x * 0.24;
    const halfDepth = fullSize.z * 0.28;
    return new Box3(
      new Vector3(fullCenter.x - halfWidth, bottom, fullCenter.z - halfDepth),
      new Vector3(fullCenter.x + halfWidth, hips.y + fullSize.y * 0.035, fullCenter.z + halfDepth),
    );
  }

  if (category === "shoes") {
    const footY = leftFoot && rightFoot ? Math.min(leftFoot.y, rightFoot.y) : full.min.y;
    return new Box3(
      new Vector3(fullCenter.x - fullSize.x * 0.30, footY - fullSize.y * 0.025, fullCenter.z - fullSize.z * 0.42),
      new Vector3(fullCenter.x + fullSize.x * 0.30, footY + fullSize.y * 0.11, fullCenter.z + fullSize.z * 0.42),
    );
  }

  return null;
}

export function inferAvatarBodyPartBox(avatarObject: Object3D, category: WearableCategory): Box3 {
  avatarObject.updateMatrixWorld(true);
  const full = mainBodyBox(avatarObject);
  const skeletonBox = skeletonBodyPartBox(avatarObject, category, full);
  if (skeletonBox && !skeletonBox.isEmpty()) return skeletonBox;

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
    case "hoodie": return make(0.70, 0.34, 0.68, 0.60);
    case "shirt": return make(0.66, 0.38, 0.66, 0.56);
    case "jacket": return make(0.74, 0.33, 0.70, 0.64);
    case "pants": return make(0.50, 0.06, 0.50, 0.54);
    case "shorts": return make(0.50, 0.27, 0.50, 0.54);
    case "shoes": return make(0.56, 0.00, 0.12, 0.78);
    default: return make(0.40, 0.40, 0.66, 0.48);
  }
}

export type GarmentFitOptions = {
  paddingScale?: number;
  widthPadding?: number;
  depthPadding?: number;
  verticalOffset?: number;
  horizontalOffset?: number;
  forwardOffset?: number;
  minAxisRatio?: number;
  maxAxisRatio?: number;
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

  const padding = options.paddingScale ?? 1;
  const desiredX = bodySize.x * (options.widthPadding ?? 1.06) * padding;
  const desiredY = bodySize.y * padding;
  const desiredZ = bodySize.z * (options.depthPadding ?? 1.08) * padding;

  const heightScale = desiredY / garmentSize.y;
  const minRatio = options.minAxisRatio ?? 0.78;
  const maxRatio = options.maxAxisRatio ?? 1.24;
  const xScale = MathUtils.clamp(desiredX / garmentSize.x, heightScale * minRatio, heightScale * maxRatio);
  const zScale = MathUtils.clamp(desiredZ / garmentSize.z, heightScale * minRatio, heightScale * maxRatio);

  // La altura manda para que una profundidad exagerada de Meshy no convierta
  // una hoodie normal en un crop top. X/Z se corrigen, pero con límites para
  // no deformar violentamente la geometría.
  garment.scale.set(
    garment.scale.x * xScale,
    garment.scale.y * heightScale,
    garment.scale.z * zScale,
  );
  garment.updateMatrixWorld(true);

  const fittedBox = mainBodyBox(garment);
  const fittedSize = fittedBox.getSize(new Vector3());
  const fittedCenter = fittedBox.getCenter(new Vector3());
  const bodyCenter = bodyPartBox.getCenter(new Vector3());
  const targetCenter = bodyCenter.clone();
  targetCenter.x += options.horizontalOffset ?? 0;
  targetCenter.y = bodyPartBox.max.y - fittedSize.y * 0.5 + (options.verticalOffset ?? 0);
  targetCenter.z += options.forwardOffset ?? 0;

  garment.position.x += targetCenter.x - fittedCenter.x;
  garment.position.y += targetCenter.y - fittedCenter.y;
  garment.position.z += targetCenter.z - fittedCenter.z;
  garment.updateMatrixWorld(true);
}
