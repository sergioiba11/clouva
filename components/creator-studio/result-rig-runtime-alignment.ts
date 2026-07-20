import { Box3, Matrix4, Object3D, Quaternion, Skeleton, SkinnedMesh, Vector3 } from "three";
import { RIG_ERROR, findBone } from "./result-rig-v39-core";

const HIP_ALIASES = ["hips", "pelvis", "hip", "j_bip_c_hips", "cc_base_hip"];
const HEAD_ALIASES = ["head", "j_bip_c_head", "cc_base_head"];
const NECK_ALIASES = ["neck", "j_bip_c_neck", "cc_base_necktwist01"];
const LEFT_SIDE_ALIASES = ["leftarm", "leftupperarm", "upperarml", "mixamorigleftarm", "j_bip_l_upperarm", "leftupleg", "leftupperleg", "thighl"];
const RIGHT_SIDE_ALIASES = ["rightarm", "rightupperarm", "upperarmr", "mixamorigrightarm", "j_bip_r_upperarm", "rightupleg", "rightupperleg", "thighr"];
const LEFT_SHOULDER_ALIASES = ["leftshoulder", "shoulderl", "claviclel", "j_bip_l_clavicle", "leftarm", "leftupperarm"];
const RIGHT_SHOULDER_ALIASES = ["rightshoulder", "shoulderr", "clavicler", "j_bip_r_clavicle", "rightarm", "rightupperarm"];
const LEFT_FOOT_ALIASES = ["leftfoot", "footl", "mixamorigleftfoot", "j_bip_l_foot"];
const RIGHT_FOOT_ALIASES = ["rightfoot", "footr", "mixamorigrightfoot", "j_bip_r_foot"];
const UPPER_CATEGORIES = new Set(["hoodie", "shirt", "remera", "jacket", "campera"]);
const LOWER_CATEGORIES = new Set(["pants", "baggy", "shorts"]);

export type RuntimeRigAlignment = {
  scale: number;
  rotationRadians: number;
  sourceHips: [number, number, number];
  targetHips: [number, number, number];
  surfaceCorrection: {
    category: string | null;
    scale: number;
    offset: [number, number, number];
    sourceCenter: [number, number, number] | null;
    targetCenter: [number, number, number] | null;
  };
};

type AlignmentAnchors = {
  hips: Vector3;
  upper: Vector3;
  left: Vector3;
  right: Vector3;
};

type BakedRestMesh = {
  mesh: SkinnedMesh;
  geometry: SkinnedMesh["geometry"];
};

type SurfaceTarget = {
  center: Vector3;
  height: number;
};

function finiteVector(vector: Vector3) {
  return [vector.x, vector.y, vector.z].every(Number.isFinite);
}

function worldPosition(root: Object3D, aliases: string[]) {
  const bone = findBone(root, aliases);
  return bone?.getWorldPosition(new Vector3()) ?? null;
}

function resolveAnchors(root: Object3D): AlignmentAnchors {
  root.updateMatrixWorld(true);
  const hips = worldPosition(root, HIP_ALIASES);
  const upper = worldPosition(root, HEAD_ALIASES) ?? worldPosition(root, NECK_ALIASES);
  const left = worldPosition(root, LEFT_SIDE_ALIASES);
  const right = worldPosition(root, RIGHT_SIDE_ALIASES);
  if (!hips || !upper || !left || !right || ![hips, upper, left, right].every(finiteVector)) {
    throw new Error(RIG_ERROR);
  }
  return { hips, upper, left, right };
}

function median(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 1e-6).sort((a, b) => a - b);
  if (!valid.length) throw new Error(RIG_ERROR);
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function projectedDirection(vector: Vector3, normal: Vector3) {
  const projected = vector.clone().projectOnPlane(normal);
  if (projected.lengthSq() < 1e-10) throw new Error(RIG_ERROR);
  return projected.normalize();
}

function readGarmentCategory(root: Object3D) {
  let category: string | null = null;
  root.traverse((object: any) => {
    if (category) return;
    const raw = object.userData?.clouvaCategory ?? object.userData?.category;
    if (typeof raw === "string" && raw.trim()) category = raw.trim().toLowerCase();
  });
  if (category) return category;

  const haystack: string[] = [];
  root.traverse((object) => haystack.push(object.name.toLowerCase()));
  const joined = haystack.join(" ");
  for (const candidate of [...UPPER_CATEGORIES, ...LOWER_CATEGORIES, "shoes", "zapatillas"]) {
    if (joined.includes(candidate)) return candidate;
  }
  return null;
}

function skinnedSurfaceBounds(root: Object3D) {
  const box = new Box3();
  root.updateMatrixWorld(true);
  root.traverse((object: any) => {
    if (!object.isSkinnedMesh || !object.visible) return;
    object.computeBoundingBox?.();
    const local = object.boundingBox ?? object.geometry?.boundingBox;
    if (local) box.union(local.clone().applyMatrix4(object.matrixWorld));
  });
  return box;
}

function resolveSurfaceTarget(avatarRoot: Object3D, category: string | null): SurfaceTarget | null {
  const hips = worldPosition(avatarRoot, HIP_ALIASES);
  if (!hips) return null;

  if (!category || UPPER_CATEGORIES.has(category)) {
    const neck = worldPosition(avatarRoot, NECK_ALIASES) ?? worldPosition(avatarRoot, HEAD_ALIASES);
    if (!neck) return null;
    const torsoHeight = neck.distanceTo(hips);
    if (!Number.isFinite(torsoHeight) || torsoHeight < 1e-5) return null;

    const leftShoulder = worldPosition(avatarRoot, LEFT_SHOULDER_ALIASES);
    const rightShoulder = worldPosition(avatarRoot, RIGHT_SHOULDER_ALIASES);
    const shoulderCenter = leftShoulder && rightShoulder
      ? leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5)
      : neck;
    const center = hips.clone().lerp(shoulderCenter, 0.58);
    return { center, height: torsoHeight * 1.12 };
  }

  if (LOWER_CATEGORIES.has(category)) {
    const leftFoot = worldPosition(avatarRoot, LEFT_FOOT_ALIASES);
    const rightFoot = worldPosition(avatarRoot, RIGHT_FOOT_ALIASES);
    if (!leftFoot || !rightFoot) return null;
    const feetCenter = leftFoot.clone().add(rightFoot).multiplyScalar(0.5);
    const legHeight = hips.distanceTo(feetCenter);
    if (!Number.isFinite(legHeight) || legHeight < 1e-5) return null;
    return { center: hips.clone().lerp(feetCenter, 0.52), height: legHeight * 1.02 };
  }

  return null;
}

/** Capture the exact visible local surface produced by the exported bind pose. */
function captureExportedRestSurface(root: Object3D): BakedRestMesh[] {
  const captured: BakedRestMesh[] = [];
  root.updateMatrixWorld(true);

  root.traverse((object: any) => {
    if (!object.isSkinnedMesh) return;
    const mesh = object as SkinnedMesh;
    const skeleton = mesh.skeleton;
    const position = mesh.geometry.getAttribute("position");
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    if (!skeleton?.bones.length || !position || !skinIndex || !skinWeight) return;

    skeleton.update();
    const geometry = mesh.geometry.clone();
    const bakedPosition = geometry.getAttribute("position");
    const vertex = new Vector3();

    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index);
      mesh.applyBoneTransform(index, vertex);
      bakedPosition.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }

    bakedPosition.needsUpdate = true;
    if (geometry.getAttribute("normal")) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    captured.push({ mesh, geometry });
  });

  return captured;
}

function applyCapturedRestSurface(captured: BakedRestMesh[]) {
  for (const { mesh, geometry } of captured) {
    mesh.geometry = geometry;
    mesh.updateMatrixWorld(true);
    mesh.bindMode = "detached";

    const neutralSkeleton = new Skeleton([...mesh.skeleton.bones]);
    neutralSkeleton.calculateInverses();
    mesh.bind(neutralSkeleton, mesh.matrixWorld.clone());
    mesh.normalizeSkinWeights();
    mesh.frustumCulled = false;
  }
}

function correctSurfacePlacement(rigRoot: Object3D, avatarRoot: Object3D) {
  const category = readGarmentCategory(rigRoot);
  const target = resolveSurfaceTarget(avatarRoot, category);
  const sourceBounds = skinnedSurfaceBounds(rigRoot);
  if (!target || sourceBounds.isEmpty()) {
    return {
      category,
      scale: 1,
      offset: [0, 0, 0] as [number, number, number],
      sourceCenter: null,
      targetCenter: null,
    };
  }

  const sourceCenter = sourceBounds.getCenter(new Vector3());
  const sourceSize = sourceBounds.getSize(new Vector3());
  const sourceHeight = Math.max(sourceSize.y, 1e-5);
  const rawScale = target.height / sourceHeight;
  const scale = rawScale < 0.62 || rawScale > 1.65
    ? Math.max(0.62, Math.min(1.65, rawScale))
    : 1;
  const offset = target.center.clone().sub(sourceCenter);

  rigRoot.updateMatrixWorld(true);
  rigRoot.traverse((object: any) => {
    if (!object.isSkinnedMesh) return;
    const mesh = object as SkinnedMesh;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;

    const inverseWorld = mesh.matrixWorld.clone().invert();
    const vertex = new Vector3();
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index);
      vertex.applyMatrix4(mesh.matrixWorld);
      vertex.sub(sourceCenter).multiplyScalar(scale).add(target.center);
      vertex.applyMatrix4(inverseWorld);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    position.needsUpdate = true;
    if (mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.frustumCulled = false;
  });
  rigRoot.updateMatrixWorld(true);

  const correctedBounds = skinnedSurfaceBounds(rigRoot);
  const correctedCenter = correctedBounds.getCenter(new Vector3());
  if (correctedBounds.isEmpty() || correctedCenter.distanceTo(target.center) > target.height * 0.08) {
    throw new Error(RIG_ERROR);
  }

  return {
    category,
    scale,
    offset: [offset.x, offset.y, offset.z] as [number, number, number],
    sourceCenter: [sourceCenter.x, sourceCenter.y, sourceCenter.z] as [number, number, number],
    targetCenter: [target.center.x, target.center.y, target.center.z] as [number, number, number],
  };
}

/** Align the exported armature, then place its visible garment on the matching avatar region. */
export function alignRigToActiveAvatar(rigRoot: Object3D, avatarRoot: Object3D): RuntimeRigAlignment {
  const source = resolveAnchors(rigRoot);
  const target = resolveAnchors(avatarRoot);
  const capturedRestSurface = captureExportedRestSurface(rigRoot);

  const sourceUp = source.upper.clone().sub(source.hips);
  const targetUp = target.upper.clone().sub(target.hips);
  const sourceRight = source.right.clone().sub(source.left);
  const targetRight = target.right.clone().sub(target.left);
  const sourceUpLength = sourceUp.length();
  const targetUpLength = targetUp.length();
  const sourceRightLength = sourceRight.length();
  const targetRightLength = targetRight.length();
  if (Math.min(sourceUpLength, targetUpLength, sourceRightLength, targetRightLength) < 1e-6) {
    throw new Error(RIG_ERROR);
  }

  const scale = median([
    targetUpLength / sourceUpLength,
    targetRightLength / sourceRightLength,
  ]);
  if (!Number.isFinite(scale) || scale < 0.001 || scale > 1000) throw new Error(RIG_ERROR);

  const sourceUpUnit = sourceUp.normalize();
  const targetUpUnit = targetUp.normalize();
  const alignUp = new Quaternion().setFromUnitVectors(sourceUpUnit, targetUpUnit);
  const rotatedSourceRight = projectedDirection(sourceRight.applyQuaternion(alignUp), targetUpUnit);
  const targetRightProjected = projectedDirection(targetRight, targetUpUnit);
  const dot = Math.max(-1, Math.min(1, rotatedSourceRight.dot(targetRightProjected)));
  const cross = rotatedSourceRight.clone().cross(targetRightProjected);
  const rotationRadians = Math.atan2(targetUpUnit.dot(cross), dot);
  const twist = new Quaternion().setFromAxisAngle(targetUpUnit, rotationRadians);
  const rotation = twist.multiply(alignUp).normalize();

  const worldAlignment = new Matrix4()
    .makeTranslation(target.hips.x, target.hips.y, target.hips.z)
    .multiply(new Matrix4().makeRotationFromQuaternion(rotation))
    .multiply(new Matrix4().makeScale(scale, scale, scale))
    .multiply(new Matrix4().makeTranslation(-source.hips.x, -source.hips.y, -source.hips.z));

  rigRoot.updateMatrixWorld(true);
  const parentWorld = rigRoot.parent?.matrixWorld.clone() ?? new Matrix4().identity();
  const localAlignment = parentWorld.clone().invert().multiply(worldAlignment).multiply(parentWorld);
  rigRoot.applyMatrix4(localAlignment);
  rigRoot.updateMatrixWorld(true);
  applyCapturedRestSurface(capturedRestSurface);
  rigRoot.updateMatrixWorld(true);

  const alignedHips = worldPosition(rigRoot, HIP_ALIASES);
  if (!alignedHips || alignedHips.distanceTo(target.hips) > Math.max(targetUpLength * 0.02, 1e-4)) {
    throw new Error(RIG_ERROR);
  }

  const surfaceCorrection = correctSurfacePlacement(rigRoot, avatarRoot);

  return {
    scale,
    rotationRadians,
    sourceHips: [source.hips.x, source.hips.y, source.hips.z],
    targetHips: [target.hips.x, target.hips.y, target.hips.z],
    surfaceCorrection,
  };
}
