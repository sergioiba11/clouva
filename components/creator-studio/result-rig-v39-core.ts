import {
  AnimationAction,
  AnimationClip,
  Bone,
  Box3,
  LoopRepeat,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";

export type BoneSnapshot = {
  bone: Bone;
  quaternion: Quaternion;
  position: Vector3;
};

export type ProceduralMotion = {
  update: (time: number) => void;
  reset: () => void;
  usable: boolean;
};

export type SharedSkeletonReport = {
  meshes: number;
  mappedBones: number;
  totalBones: number;
  missingBones: string[];
  ignoredUnusedBones: string[];
};

export const RIG_ERROR = "Rig incompatible: escala o bind pose incorrecta";
const HIP_ALIASES = ["hips", "pelvis", "hip", "j_bip_c_hips", "cc_base_hip"];
const LEFT_UP_LEG_ALIASES = ["leftupleg", "leftupperleg", "thighl", "upperlegl", "mixamorigleftupleg", "j_bip_l_upperleg"];
const RIGHT_UP_LEG_ALIASES = ["rightupleg", "rightupperleg", "thighr", "upperlegr", "mixamorigrightupleg", "j_bip_r_upperleg"];
const LEFT_LEG_ALIASES = ["leftleg", "leftlowerleg", "calfl", "shinl", "lowerlegl", "mixamorigleftleg", "j_bip_l_lowerleg"];
const RIGHT_LEG_ALIASES = ["rightleg", "rightlowerleg", "calfr", "shinr", "lowerlegr", "mixamorigrightleg", "j_bip_r_lowerleg"];
const LEFT_ARM_ALIASES = ["leftarm", "leftupperarm", "upperarml", "mixamorigleftarm", "j_bip_l_upperarm"];
const RIGHT_ARM_ALIASES = ["rightarm", "rightupperarm", "upperarmr", "mixamorigrightarm", "j_bip_r_upperarm"];
const X_AXIS = new Vector3(1, 0, 0);

export function cleanName(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^mixamorig[:_]?/, "")
    .replace(/^armature[|/.:_-]?/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function collectBones(root: Object3D) {
  const bones = new Map<string, Bone>();
  root.traverse((object: any) => {
    if (object.isBone) {
      const bone = object as Bone;
      const key = cleanName(bone.name);
      if (key && !bones.has(key)) bones.set(key, bone);
    }
    if (object.isSkinnedMesh) {
      for (const bone of (object as SkinnedMesh).skeleton?.bones ?? []) {
        const key = cleanName(bone.name);
        if (key && !bones.has(key)) bones.set(key, bone);
      }
    }
  });
  return bones;
}

export function findBone(root: Object3D, aliases: string[]): Bone | null {
  const bones = collectBones(root);
  const normalized = aliases.map(cleanName);
  for (const alias of normalized) {
    const exact = bones.get(alias);
    if (exact) return exact;
  }
  for (const [name, bone] of bones) {
    if (normalized.some((alias) => alias && (name.includes(alias) || alias.includes(name)))) return bone;
  }
  return null;
}

export function findObjectMesh(root: Object3D): SkinnedMesh | null {
  const candidates: SkinnedMesh[] = [];
  root.traverse((object: any) => {
    if (object.isSkinnedMesh) candidates.push(object as SkinnedMesh);
  });
  return candidates.find((mesh) => /garment|object|cloth|wearable/i.test(mesh.name)) ?? candidates[0] ?? null;
}

export function visibleMeshBounds(root: Object3D) {
  const box = new Box3();
  root.updateMatrixWorld(true);
  root.traverse((object: any) => {
    if ((!object.isMesh && !object.isSkinnedMesh) || !object.visible) return;
    box.expandByObject(object, true);
  });
  return box;
}

export function animatedGarmentBounds(root: Object3D) {
  const box = new Box3();
  root.updateMatrixWorld(true);
  root.traverse((object: any) => {
    if ((!object.isMesh && !object.isSkinnedMesh) || !object.visible) return;
    if (object.isSkinnedMesh) object.computeBoundingBox?.();
    else object.geometry?.computeBoundingBox?.();
    const local = object.boundingBox ?? object.geometry?.boundingBox;
    if (local) box.union(local.clone().applyMatrix4(object.matrixWorld));
  });
  return box;
}

export function boxDiagnostics(box: Box3) {
  if (box.isEmpty()) return null;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  return {
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  };
}

export function transformDiagnostics(root: Object3D) {
  return {
    position: [root.position.x, root.position.y, root.position.z],
    rotation: [root.rotation.x, root.rotation.y, root.rotation.z],
    scale: [root.scale.x, root.scale.y, root.scale.z],
  };
}

export function isIdentityRoot(root: Object3D, epsilon = 1e-4) {
  const values = [
    root.position.x,
    root.position.y,
    root.position.z,
    root.rotation.x,
    root.rotation.y,
    root.rotation.z,
    root.scale.x - 1,
    root.scale.y - 1,
    root.scale.z - 1,
  ];
  return values.every((value) => Number.isFinite(value) && Math.abs(value) <= epsilon);
}

export function validateBounds(avatarBox: Box3, garmentBox: Box3) {
  if (avatarBox.isEmpty() || garmentBox.isEmpty()) throw new Error(RIG_ERROR);
  const avatarSize = avatarBox.getSize(new Vector3());
  const garmentSize = garmentBox.getSize(new Vector3());
  const avatarHeight = Math.max(avatarSize.y, 1e-5);
  const garmentHeight = Math.max(garmentSize.y, garmentSize.x, garmentSize.z);
  const avatarCenter = avatarBox.getCenter(new Vector3());
  const corners = [
    new Vector3(garmentBox.min.x, garmentBox.min.y, garmentBox.min.z),
    new Vector3(garmentBox.min.x, garmentBox.min.y, garmentBox.max.z),
    new Vector3(garmentBox.min.x, garmentBox.max.y, garmentBox.min.z),
    new Vector3(garmentBox.min.x, garmentBox.max.y, garmentBox.max.z),
    new Vector3(garmentBox.max.x, garmentBox.min.y, garmentBox.min.z),
    new Vector3(garmentBox.max.x, garmentBox.min.y, garmentBox.max.z),
    new Vector3(garmentBox.max.x, garmentBox.max.y, garmentBox.min.z),
    new Vector3(garmentBox.max.x, garmentBox.max.y, garmentBox.max.z),
  ];
  const farthest = Math.max(...corners.map((corner) => corner.distanceTo(avatarCenter)));
  if (!Number.isFinite(garmentHeight) || garmentHeight > avatarHeight * 3 || farthest > avatarHeight * 3) {
    throw new Error(RIG_ERROR);
  }
  return { avatarHeight, garmentHeight, farthest };
}

export function compareBindPose(avatarRoot: Object3D, garmentRoot: Object3D, avatarHeight: number) {
  const avatarBones = collectBones(avatarRoot);
  const garmentBones = collectBones(garmentRoot);
  const errors: Array<{ name: string; error: number }> = [];
  for (const [name, source] of avatarBones) {
    const target = garmentBones.get(name);
    if (!target) continue;
    const sourcePosition = source.getWorldPosition(new Vector3());
    const targetPosition = target.getWorldPosition(new Vector3());
    errors.push({ name, error: sourcePosition.distanceTo(targetPosition) / Math.max(avatarHeight, 1e-5) });
  }
  errors.sort((a, b) => b.error - a.error);
  const keyErrors = errors.filter(({ name }) => /hips|pelvis|spine|neck|head|arm|leg|foot/.test(name));
  const sample = keyErrors.length >= 6 ? keyErrors : errors;
  const median = sample.length ? sample[Math.floor(sample.length / 2)].error : Number.POSITIVE_INFINITY;
  const maximum = sample[0]?.error ?? Number.POSITIVE_INFINITY;
  if (sample.length < 6 || median > 0.08 || maximum > 0.35) throw new Error(RIG_ERROR);
  return { compared: sample.length, median, maximum };
}

function usedBoneIndices(mesh: SkinnedMesh) {
  const used = new Set<number>();
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight) {
    for (let index = 0; index < (mesh.skeleton?.bones.length ?? 0); index += 1) used.add(index);
    return used;
  }

  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    const indexes = [skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex)];
    const weights = [skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex)];
    for (let slot = 0; slot < 4; slot += 1) {
      if (Number.isFinite(weights[slot]) && weights[slot] > 0.00001) used.add(Math.trunc(indexes[slot]));
    }
  }
  return used;
}

function compatibleAvatarBone(avatarBones: Map<string, Bone>, sourceName: string) {
  const key = cleanName(sourceName);
  const exact = avatarBones.get(key);
  if (exact) return exact;
  if (key.length < 4) return undefined;

  const candidates = [...avatarBones.entries()]
    .filter(([candidate]) => candidate.includes(key) || key.includes(candidate));
  return candidates.length === 1 ? candidates[0][1] : undefined;
}

export function bindGarmentToAvatar(garmentRoot: Object3D, avatarRoot: Object3D): SharedSkeletonReport {
  const avatarBones = collectBones(avatarRoot);
  const fallbackBone = findBone(avatarRoot, HIP_ALIASES) ?? avatarBones.values().next().value as Bone | undefined;
  const skinnedMeshes: SkinnedMesh[] = [];
  garmentRoot.traverse((object: any) => {
    if (object.isSkinnedMesh) skinnedMeshes.push(object as SkinnedMesh);
  });

  let meshes = 0;
  let mappedBones = 0;
  let totalBones = 0;
  const missing = new Set<string>();
  const ignoredUnused = new Set<string>();

  garmentRoot.updateMatrixWorld(true);
  avatarRoot.updateMatrixWorld(true);

  for (const mesh of skinnedMeshes) {
    const originalBones = mesh.skeleton?.bones ?? [];
    if (!originalBones.length) continue;
    const usedIndices = usedBoneIndices(mesh);
    totalBones += usedIndices.size;

    const mapped = originalBones.map((bone, index) => {
      const replacement = compatibleAvatarBone(avatarBones, bone.name);
      if (replacement) {
        if (usedIndices.has(index)) mappedBones += 1;
        return replacement;
      }
      if (usedIndices.has(index)) missing.add(bone.name || `hueso-${index}`);
      else ignoredUnused.add(bone.name || `hueso-${index}`);
      return fallbackBone;
    });

    if (!fallbackBone || mapped.some((bone) => !bone)) continue;
    if ([...usedIndices].some((index) => !mapped[index])) continue;

    const sharedSkeleton = new Skeleton(mapped as Bone[]);
    sharedSkeleton.calculateInverses();
    mesh.bind(sharedSkeleton, mesh.matrixWorld.clone());
    mesh.normalizeSkinWeights();
    mesh.frustumCulled = false;
    meshes += 1;
  }

  const report: SharedSkeletonReport = {
    meshes,
    mappedBones,
    totalBones,
    missingBones: [...missing],
    ignoredUnusedBones: [...ignoredUnused],
  };
  if (!meshes || !totalBones || mappedBones / totalBones < 0.95 || report.missingBones.length) {
    console.error("[CLOUVA rig] faltan huesos con peso real", report);
    const detail = report.missingBones.length
      ? ` · faltan huesos con peso: ${report.missingBones.slice(0, 6).join(", ")}`
      : "";
    throw new Error(`${RIG_ERROR}${detail}`);
  }
  if (report.ignoredUnusedBones.length) {
    console.info("[CLOUVA rig] huesos exportados sin peso ignorados", report.ignoredUnusedBones);
  }
  return report;
}

export function inspectAnchorBone(mesh: SkinnedMesh) {
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  const bones = mesh.skeleton?.bones ?? [];
  if (!skinIndex || !skinWeight || !bones.length) return { anchorBoneName: null, weightedVertexRatio: null };
  const dominantCounts = new Map<number, number>();
  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    const indexes = [skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex)];
    const weights = [skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex)];
    let slot = 0;
    for (let index = 1; index < weights.length; index += 1) if (weights[index] > weights[slot]) slot = index;
    dominantCounts.set(indexes[slot], (dominantCounts.get(indexes[slot]) ?? 0) + 1);
  }
  const dominant = [...dominantCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    anchorBoneName: dominant ? bones[dominant[0]]?.name ?? null : null,
    weightedVertexRatio: dominant ? dominant[1] / Math.max(skinIndex.count, 1) : null,
  };
}

export function avatarOcclusionTokens(category: string | undefined) {
  if (category === "baggy" || category === "pants" || category === "shorts") return ["pants", "trouser", "shorts", "jeans", "bottom", "pantalon"];
  if (["hoodie", "shirt", "remera", "jacket", "campera"].includes(category ?? "")) return ["hoodie", "shirt", "jacket", "top", "sweater", "remera", "campera"];
  if (category === "shoes" || category === "zapatillas") return ["shoe", "sneaker", "boot", "footwear", "zapatilla"];
  return [];
}

export function prepareAvatarMeshes(root: Object3D, category: string | undefined) {
  const tokens = avatarOcclusionTokens(category).map(cleanName);
  root.traverse((object: any) => {
    if (!object.isMesh && !object.isSkinnedMesh) return;
    object.visible = true;
    object.frustumCulled = false;
    object.normalizeSkinWeights?.();
    if (!tokens.length) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const haystack = cleanName([object.name, ...materials.map((material: any) => material?.name)].join(" "));
    if (tokens.some((token) => haystack.includes(token))) object.visible = false;
  });
}

export function friendlyClipLabel(name: string, index: number) {
  const normalized = cleanName(name);
  if (normalized.includes("walk")) return "Caminar";
  if (normalized.includes("run")) return "Correr";
  if (normalized.includes("idle") || normalized.includes("breath")) return "Respiración";
  if (normalized.includes("tpose")) return "T-Pose";
  if (index === 0 || normalized.includes("baselayer") || normalized.includes("clip0")) return "Movimiento exportado";
  return `Movimiento ${index + 1}`;
}

export function clipSignature(trackNames: string[]) {
  return trackNames.slice().sort().join("|");
}

export function clipMotionScore(clip: AnimationClip) {
  let score = 0;
  for (const track of clip.tracks) {
    const values = Array.from(track.values as ArrayLike<number>);
    if (values.length < 2) continue;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    if (Number.isFinite(minimum) && Number.isFinite(maximum)) score += maximum - minimum;
  }
  return score;
}

export function stopAction(action: AnimationAction) {
  action.enabled = false;
  action.paused = false;
  action.stop();
}

export function startAction(action: AnimationAction) {
  action.stop();
  action.reset();
  action.enabled = true;
  action.paused = false;
  action.clampWhenFinished = false;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(1);
  action.setLoop(LoopRepeat, Infinity);
  action.play();
}

export function snapshotBone(root: Object3D, aliases: string[]): BoneSnapshot | null {
  const bone = findBone(root, aliases);
  return bone ? { bone, quaternion: bone.quaternion.clone(), position: bone.position.clone() } : null;
}

export function applyBoneRotation(snapshot: BoneSnapshot | null, angle: number) {
  if (!snapshot) return;
  snapshot.bone.quaternion.copy(snapshot.quaternion).multiply(new Quaternion().setFromAxisAngle(X_AXIS, angle));
}

export function createProceduralMotion(root: Object3D): ProceduralMotion {
  const hips = snapshotBone(root, HIP_ALIASES);
  const leftUpperLeg = snapshotBone(root, LEFT_UP_LEG_ALIASES);
  const rightUpperLeg = snapshotBone(root, RIGHT_UP_LEG_ALIASES);
  const leftLeg = snapshotBone(root, LEFT_LEG_ALIASES);
  const rightLeg = snapshotBone(root, RIGHT_LEG_ALIASES);
  const leftArm = snapshotBone(root, LEFT_ARM_ALIASES);
  const rightArm = snapshotBone(root, RIGHT_ARM_ALIASES);
  const snapshots = [hips, leftUpperLeg, rightUpperLeg, leftLeg, rightLeg, leftArm, rightArm].filter(Boolean) as BoneSnapshot[];
  return {
    usable: Boolean(hips && leftUpperLeg && rightUpperLeg),
    update(time: number) {
      const phase = Math.sin(time * 2.7);
      const opposite = Math.sin(time * 2.7 + Math.PI);
      const bob = Math.abs(Math.sin(time * 5.4)) * 0.018;
      if (hips) hips.bone.position.copy(hips.position).add(new Vector3(0, bob, 0));
      applyBoneRotation(leftUpperLeg, phase * 0.38);
      applyBoneRotation(rightUpperLeg, opposite * 0.38);
      applyBoneRotation(leftLeg, Math.max(0, -phase) * 0.48);
      applyBoneRotation(rightLeg, Math.max(0, -opposite) * 0.48);
      applyBoneRotation(leftArm, opposite * 0.24);
      applyBoneRotation(rightArm, phase * 0.24);
    },
    reset() {
      snapshots.forEach((snapshot) => {
        snapshot.bone.quaternion.copy(snapshot.quaternion);
        snapshot.bone.position.copy(snapshot.position);
      });
    },
  };
}

export function disposeModel(root: Object3D | null) {
  root?.removeFromParent();
  root?.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
    else object.material?.dispose?.();
  });
}
