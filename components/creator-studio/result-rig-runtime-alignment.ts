import { Matrix4, Object3D, Quaternion, Skeleton, SkinnedMesh, Vector3 } from "three";
import { RIG_ERROR, findBone } from "./result-rig-v39-core";

const HIP_ALIASES = ["hips", "pelvis", "hip", "j_bip_c_hips", "cc_base_hip"];
const HEAD_ALIASES = ["head", "j_bip_c_head", "cc_base_head"];
const NECK_ALIASES = ["neck", "j_bip_c_neck", "cc_base_necktwist01"];
const LEFT_SIDE_ALIASES = ["leftarm", "leftupperarm", "upperarml", "mixamorigleftarm", "j_bip_l_upperarm", "leftupleg", "leftupperleg", "thighl"];
const RIGHT_SIDE_ALIASES = ["rightarm", "rightupperarm", "upperarmr", "mixamorigrightarm", "j_bip_r_upperarm", "rightupleg", "rightupperleg", "thighr"];

export type RuntimeRigAlignment = {
  scale: number;
  rotationRadians: number;
  sourceHips: [number, number, number];
  targetHips: [number, number, number];
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

/**
 * GLB can encode a non-trivial bind matrix even when its bones are canonical.
 * Before replacing those bones with the avatar bones, capture the exact surface
 * produced by the exported bind pose. This prevents the garment from jumping
 * below the avatar or stretching toward the hips when motion begins.
 */
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

    // Neutral rest bind in the already-aligned coordinate space. The shared
    // skeleton remap that follows can now preserve the visible exported shape.
    const neutralSkeleton = new Skeleton([...mesh.skeleton.bones]);
    neutralSkeleton.calculateInverses();
    mesh.bind(neutralSkeleton, mesh.matrixWorld.clone());
    mesh.normalizeSkinWeights();
    mesh.frustumCulled = false;
  }
}

/**
 * The Worker output and the active web avatar may contain the same official bones under
 * different FBX/GLB root conversions. This computes one similarity transform from the
 * shared bind-pose landmarks and applies it to the complete rig scene before validation.
 * The garment and its exported armature remain together; they are never normalized alone.
 */
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

  return {
    scale,
    rotationRadians,
    sourceHips: [source.hips.x, source.hips.y, source.hips.z],
    targetHips: [target.hips.x, target.hips.y, target.hips.z],
  };
}
