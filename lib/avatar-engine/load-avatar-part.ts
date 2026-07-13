import { Box3, Color, Material, Mesh, Object3D, SkinnedMesh, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { resolveAvatarAssetUrl } from "./assets";
import { CLOUVA_SKELETON_ID, type AvatarCompatibilityStatus, type AvatarItem, type BaseAvatarModel, type LoadedAvatarPart } from "./types";

const gltfCache = new Map<string, Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>>();
const originalMaterials = new WeakMap<Object3D, Map<string, Material | Material[]>>();

export function analyzeObject(root: Object3D) {
  const boneNames = new Set<string>(); const meshNames: string[] = []; const skinnedMeshNames: string[] = []; const materialNames = new Set<string>(); const morphNames = new Set<string>();
  root.traverse((object) => {
    if (object.type === "Bone") boneNames.add(object.name);
    const mesh = object as Mesh;
    if (mesh.isMesh) {
      meshNames.push(mesh.name || mesh.uuid);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.filter(Boolean).forEach((material) => materialNames.add(material.name || material.uuid));
      if (mesh.morphTargetDictionary) Object.keys(mesh.morphTargetDictionary).forEach((name) => morphNames.add(name));
    }
    if ((object as SkinnedMesh).isSkinnedMesh) skinnedMeshNames.push(object.name || object.uuid);
  });
  const box = new Box3().setFromObject(root); const size = new Vector3(); const center = new Vector3(); box.getSize(size); box.getCenter(center);
  return { boneNames: [...boneNames], meshNames, skinnedMeshNames, materialNames: [...materialNames], morphNames: [...morphNames], box, size, center };
}

export function normalizeAvatarObject(root: Object3D, targetHeight = 1.85) {
  root.updateMatrixWorld(true);
  const before = analyzeObject(root);
  const height = before.size.y || 1;
  root.scale.multiplyScalar(targetHeight / height);
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root); const center = new Vector3(); box.getCenter(center);
  root.position.x -= center.x; root.position.z -= center.z; root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  return analyzeObject(root);
}

export function cloneMaterials(root: Object3D) {
  const saved = new Map<string, Material | Material[]>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    saved.set(mesh.uuid, mesh.material);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
  originalMaterials.set(root, saved);
}

export function disposeAvatarObject(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean).forEach((material) => material.dispose());
  });
}

export function restoreOriginalMaterials(root: Object3D) {
  const saved = originalMaterials.get(root); if (!saved) return;
  root.traverse((object) => { const mesh = object as Mesh; const material = saved.get(mesh.uuid); if (mesh.isMesh && material) mesh.material = material; });
}

export function applyMaterialColors(root: Object3D, colors: Record<string, string>) {
  root.traverse((object) => {
    const mesh = object as Mesh; if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => { if (material?.name && colors[material.name] && "color" in material) (material as Material & { color: Color }).color = new Color(colors[material.name]); });
  });
}

export const setSkinTone = (root: Object3D, color: string) => applyMaterialColors(root, { Skin: color, Skin_Main: color, Body_Skin: color });
export const setHairColor = (root: Object3D, color: string) => applyMaterialColors(root, { Hair: color, Hair_Main: color });

export function applyMorphValues(root: Object3D, values: Record<string, number>) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    Object.entries(values).forEach(([name, value]) => { const index = mesh.morphTargetDictionary?.[name]; if (typeof index === "number" && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, value)); });
  });
}

export function validateAvatarItemCompatibility(item: AvatarItem, baseModel?: BaseAvatarModel | null): AvatarCompatibilityStatus {
  const reasons: string[] = []; const warnings: string[] = [];
  const skeleton = item.skeletonId ?? item.compatibleSkeleton;
  if (skeleton !== CLOUVA_SKELETON_ID) reasons.push(`Skeleton no oficial: ${skeleton}`);
  if (baseModel && skeleton !== baseModel.skeletonId) reasons.push(`Skeleton ${skeleton} no coincide con base ${baseModel.skeletonId}`);
  if (!["body", "face", "hair", "top", "bottom", "shoes", "accessory"].includes(item.category)) reasons.push(`Categoría inválida: ${item.category}`);
  if (!resolveAvatarAssetUrl(item)) reasons.push("modelUrl ausente o inválido");
  if (item.materialNames?.length === 0) warnings.push("Sin materiales declarados");
  if (baseModel && baseModel.boneNames.length > 0 && baseModel.boneNames.length < 12) warnings.push("El cuerpo base tiene pocos huesos detectados");
  return { compatible: reasons.length === 0, reasons, warnings };
}

export async function loadAvatarPart(item: AvatarItem, baseModel?: BaseAvatarModel | null): Promise<LoadedAvatarPart> {
  const status = validateAvatarItemCompatibility(item, baseModel); if (!status.compatible) throw new Error(status.reasons.join("; "));
  const modelUrl = resolveAvatarAssetUrl(item); if (!modelUrl) throw new Error(`Avatar part ${item.id} has no modelUrl`);
  const loader = new GLTFLoader();
  const gltf = await (gltfCache.get(modelUrl) ?? gltfCache.set(modelUrl, loader.loadAsync(modelUrl)).get(modelUrl)!);
  const object = cloneSkeleton(gltf.scene) as typeof gltf.scene;
  cloneMaterials(object);
  const analysis = analyzeObject(object);
  if (item.category !== "body" && baseModel?.boneNames.length && analysis.skinnedMeshNames.length && !analysis.boneNames.some((bone) => baseModel.boneNames.includes(bone))) throw new Error(`Avatar part ${item.id} does not share base bones`);
  return { item, object, animations: gltf.animations, skeletonId: item.skeletonId ?? item.compatibleSkeleton, ...analysis, materialNames: analysis.materialNames, morphNames: analysis.morphNames, modelUrl, dispose: () => disposeAvatarObject(object) };
}
