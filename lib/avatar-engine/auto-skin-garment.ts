import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3,
  Vector4,
} from "three";
import type { WearableCategory } from "@/lib/avatar-engine/frame-avatar";

const CATEGORY_BONE_WORDS: Record<WearableCategory, string[]> = {
  hoodie: ["spine", "chest", "clavicle", "shoulder", "upperarm", "lowerarm", "forearm", "hand"],
  shirt: ["spine", "chest", "clavicle", "shoulder", "upperarm", "lowerarm", "forearm", "hand"],
  jacket: ["spine", "chest", "clavicle", "shoulder", "upperarm", "lowerarm", "forearm", "hand"],
  pants: ["hips", "pelvis", "upleg", "upperleg", "thigh", "leg", "calf", "foot"],
  shorts: ["hips", "pelvis", "upleg", "upperleg", "thigh"],
  shoes: ["foot", "toe", "ankle", "leg"],
  accessory: ["spine", "chest", "neck", "head", "hips", "pelvis"],
};

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findAvatarSkeleton(avatar: Object3D): Skeleton | null {
  let skeleton: Skeleton | null = null;
  avatar.traverse((child) => {
    if (!skeleton && (child as SkinnedMesh).isSkinnedMesh) skeleton = (child as SkinnedMesh).skeleton;
  });
  return skeleton;
}

function relevantBones(skeleton: Skeleton, category: WearableCategory) {
  const words = CATEGORY_BONE_WORDS[category].map(normalizedName);
  const filtered = skeleton.bones.filter((bone) => {
    const name = normalizedName(bone.name);
    return words.some((word) => name.includes(word));
  });
  return filtered.length >= 2 ? filtered : skeleton.bones;
}

function calculateWeights(worldPosition: Vector3, bones: Bone[]) {
  const nearest = bones
    .map((bone, index) => ({ index, distance: Math.max(worldPosition.distanceTo(bone.getWorldPosition(new Vector3())), 0.001) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 4);

  const raw = nearest.map((entry) => 1 / (entry.distance * entry.distance));
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  const indices = new Vector4(0, 0, 0, 0);
  const weights = new Vector4(0, 0, 0, 0);

  nearest.forEach((entry, slot) => {
    indices.setComponent(slot, entry.index);
    weights.setComponent(slot, raw[slot] / total);
  });

  return { indices, weights };
}

function bakeGeometryToAvatarSpace(mesh: Mesh, avatar: Object3D) {
  mesh.updateMatrixWorld(true);
  avatar.updateMatrixWorld(true);
  const matrix = new Matrix4().copy(avatar.matrixWorld).invert().multiply(mesh.matrixWorld);
  const geometry = mesh.geometry.clone() as BufferGeometry;
  geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Convierte las mallas estáticas generadas por Meshy en SkinnedMesh vinculadas
 * al esqueleto del avatar. Los pesos se calculan por proximidad a los huesos
 * relevantes para cada categoría, permitiendo que mangas y piernas acompañen
 * hombros, codos, cadera y rodillas durante la animación.
 */
export function autoSkinGarmentToAvatar(
  avatar: Object3D,
  garment: Object3D,
  category: WearableCategory,
): boolean {
  const skeleton = findAvatarSkeleton(avatar);
  if (!skeleton || skeleton.bones.length === 0) return false;

  avatar.updateMatrixWorld(true);
  garment.updateMatrixWorld(true);
  skeleton.bones.forEach((bone) => bone.updateMatrixWorld(true));

  const bones = relevantBones(skeleton, category);
  const skeletonIndex = new Map(skeleton.bones.map((bone, index) => [bone.uuid, index]));
  const meshes: Mesh[] = [];
  garment.traverse((child) => {
    if ((child as Mesh).isMesh && !(child as SkinnedMesh).isSkinnedMesh) meshes.push(child as Mesh);
  });
  if (meshes.length === 0) return false;

  for (const mesh of meshes) {
    const geometry = bakeGeometryToAvatarSpace(mesh, avatar);
    const positions = geometry.getAttribute("position");
    if (!positions || positions.count === 0) continue;

    const skinIndices = new Uint16Array(positions.count * 4);
    const skinWeights = new Float32Array(positions.count * 4);
    const local = new Vector3();
    const world = new Vector3();

    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      local.fromBufferAttribute(positions, vertex);
      world.copy(local).applyMatrix4(avatar.matrixWorld);
      const result = calculateWeights(world, bones);

      for (let slot = 0; slot < 4; slot += 1) {
        const selectedBone = bones[result.indices.getComponent(slot)] ?? bones[0];
        skinIndices[vertex * 4 + slot] = skeletonIndex.get(selectedBone.uuid) ?? 0;
        skinWeights[vertex * 4 + slot] = result.weights.getComponent(slot);
      }
    }

    geometry.setAttribute("skinIndex", new BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new BufferAttribute(skinWeights, 4));

    const skinned = new SkinnedMesh(geometry, mesh.material);
    skinned.name = `${mesh.name || "garment"}-autoskin`;
    skinned.castShadow = mesh.castShadow;
    skinned.receiveShadow = mesh.receiveShadow;
    skinned.frustumCulled = false;
    skinned.bind(skeleton, avatar.matrixWorld);
    avatar.add(skinned);
    mesh.removeFromParent();
  }

  garment.removeFromParent();
  return true;
}
