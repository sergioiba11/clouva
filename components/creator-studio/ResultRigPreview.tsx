"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  Box3,
  Clock,
  DirectionalLight,
  Group,
  HemisphereLight,
  LoopRepeat,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Skeleton,
  SkeletonHelper,
  SkinnedMesh,
  SRGBColorSpace,
  Uint32BufferAttribute,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

export type ResultRigInfo = {
  loading: boolean;
  bones: number;
  objectMeshName: string | null;
  anchorBoneName: string | null;
  weightedVertexRatio: number | null;
  clips?: string[];
  error?: string;
};

type Props = {
  url: string | null;
  showAvatar?: boolean;
  category?: string;
  onInfo?: (info: ResultRigInfo) => void;
};

type ClipOption = {
  id: string;
  label: string;
  duration: number;
  tracks: number;
  procedural?: boolean;
};

type SyncedActionGroup = {
  garment: AnimationAction[];
  avatar: AnimationAction[];
  signatures: Set<string>;
  duration: number;
  tracks: number;
  motionScore: number;
};

type BoneSnapshot = {
  bone: Bone;
  quaternion: Quaternion;
  position: Vector3;
};

type ProceduralMotion = {
  update: (time: number) => void;
  reset: () => void;
  usable: boolean;
};

const HIP_ALIASES = ["hips", "pelvis", "hip", "j_bip_c_hips", "cc_base_hip"];
const LEFT_UP_LEG_ALIASES = ["leftupleg", "leftupperleg", "thighl", "upperlegl", "mixamorigleftupleg", "j_bip_l_upperleg"];
const RIGHT_UP_LEG_ALIASES = ["rightupleg", "rightupperleg", "thighr", "upperlegr", "mixamorigrightupleg", "j_bip_r_upperleg"];
const LEFT_LEG_ALIASES = ["leftleg", "leftlowerleg", "calfl", "shinl", "lowerlegl", "mixamorigleftleg", "j_bip_l_lowerleg"];
const RIGHT_LEG_ALIASES = ["rightleg", "rightlowerleg", "calfr", "shinr", "lowerlegr", "mixamorigrightleg", "j_bip_r_lowerleg"];
const LEFT_FOOT_ALIASES = ["leftfoot", "footl", "lfoot", "mixamorigleftfoot", "j_bip_l_foot"];
const RIGHT_FOOT_ALIASES = ["rightfoot", "footr", "rfoot", "mixamorigrightfoot", "j_bip_r_foot"];
const LEFT_ARM_ALIASES = ["leftarm", "leftupperarm", "upperarml", "mixamorigleftarm", "j_bip_l_upperarm"];
const RIGHT_ARM_ALIASES = ["rightarm", "rightupperarm", "upperarmr", "mixamorigrightarm", "j_bip_r_upperarm"];
const X_AXIS = new Vector3(1, 0, 0);

function cleanName(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findObjectMesh(root: Object3D): SkinnedMesh | null {
  const candidates: SkinnedMesh[] = [];
  root.traverse((object: any) => {
    if (object.isSkinnedMesh) candidates.push(object as SkinnedMesh);
  });
  return candidates.find((mesh) => /garment|object|cloth|wearable/i.test(mesh.name)) ?? candidates[0] ?? null;
}

function collectBones(root: Object3D) {
  const bones = new Map<string, Bone>();
  root.traverse((object: any) => {
    if (!object.isBone) return;
    const bone = object as Bone;
    const key = cleanName(bone.name);
    if (key && !bones.has(key)) bones.set(key, bone);
  });
  return bones;
}

function findBone(root: Object3D, aliases: string[]): Bone | null {
  const normalizedAliases = aliases.map(cleanName);
  let exact: Bone | null = null;
  let partial: Bone | null = null;
  root.traverse((object: any) => {
    if (!object.isBone) return;
    const bone = object as Bone;
    const name = cleanName(bone.name);
    if (!exact && normalizedAliases.includes(name)) exact = bone;
    if (!partial && normalizedAliases.some((alias) => alias && (name.includes(alias) || alias.includes(name)))) partial = bone;
  });
  return exact ?? partial;
}

function inspectAnchorBone(mesh: SkinnedMesh) {
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  const bones = mesh.skeleton?.bones ?? [];
  if (!skinIndex || !skinWeight || bones.length === 0) {
    return { anchorBoneName: null, weightedVertexRatio: null };
  }

  const dominantCounts = new Map<number, number>();
  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    const indexes = [skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex)];
    const weights = [skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex)];
    let dominantSlot = 0;
    for (let slot = 1; slot < weights.length; slot += 1) {
      if (weights[slot] > weights[dominantSlot]) dominantSlot = slot;
    }
    const boneIndex = indexes[dominantSlot];
    dominantCounts.set(boneIndex, (dominantCounts.get(boneIndex) ?? 0) + 1);
  }

  const dominant = [...dominantCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    anchorBoneName: dominant ? bones[dominant[0]]?.name ?? null : null,
    weightedVertexRatio: dominant && skinIndex.count > 0 ? dominant[1] / skinIndex.count : null,
  };
}

function friendlyClipLabel(name: string, index: number) {
  const normalized = cleanName(name);
  if (normalized.includes("walk")) return "Caminar";
  if (normalized.includes("run")) return "Correr";
  if (normalized.includes("idle") || normalized.includes("breath")) return "Respiración";
  if (normalized.includes("tpose")) return "T-Pose";
  if (index === 0 || normalized.includes("baselayer") || normalized.includes("clip0")) return "Movimiento exportado";
  return `Movimiento ${index + 1}`;
}

function avatarOcclusionTokens(category: string | undefined) {
  switch (category) {
    case "baggy":
      return ["pants", "trouser", "shorts", "jeans", "bottom", "pantalon"];
    case "hoodie":
    case "remera":
    case "campera":
      return ["hoodie", "shirt", "jacket", "top", "sweater", "remera", "campera"];
    case "zapatillas":
      return ["shoe", "sneaker", "boot", "footwear", "zapatilla"];
    default:
      return [];
  }
}

function hideConflictingAvatarClothes(root: Object3D, category: string | undefined) {
  const tokens = avatarOcclusionTokens(category);
  if (tokens.length === 0) return;
  root.traverse((object: any) => {
    if (!object.isMesh && !object.isSkinnedMesh) return;
    const materialNames = Array.isArray(object.material)
      ? object.material.map((material: any) => material?.name)
      : [object.material?.name];
    const haystack = [object.name, ...materialNames].map(cleanName).join(" ");
    if (tokens.some((token) => haystack.includes(cleanName(token)))) object.visible = false;
  });
}

function alignAvatarToResultRig(avatarRoot: Object3D, rigRoot: Object3D) {
  avatarRoot.updateMatrixWorld(true);
  rigRoot.updateMatrixWorld(true);
  const avatarHips = findBone(avatarRoot, HIP_ALIASES);
  const rigHips = findBone(rigRoot, HIP_ALIASES);
  const avatarFoot = findBone(avatarRoot, LEFT_FOOT_ALIASES) ?? findBone(avatarRoot, RIGHT_FOOT_ALIASES);
  const rigFoot = findBone(rigRoot, LEFT_FOOT_ALIASES) ?? findBone(rigRoot, RIGHT_FOOT_ALIASES);
  if (!avatarHips || !rigHips) return false;

  const avatarHipPosition = avatarHips.getWorldPosition(new Vector3());
  const rigHipPosition = rigHips.getWorldPosition(new Vector3());
  if (avatarFoot && rigFoot) {
    const avatarFootPosition = avatarFoot.getWorldPosition(new Vector3());
    const rigFootPosition = rigFoot.getWorldPosition(new Vector3());
    const avatarLeg = avatarHipPosition.distanceTo(avatarFootPosition);
    const rigLeg = rigHipPosition.distanceTo(rigFootPosition);
    const ratio = rigLeg / Math.max(avatarLeg, 1e-6);
    if (Number.isFinite(ratio) && ratio >= 0.1 && ratio <= 10) {
      avatarRoot.scale.multiplyScalar(ratio);
      avatarRoot.updateMatrixWorld(true);
    }
  }

  const alignedAvatarHips = avatarHips.getWorldPosition(new Vector3());
  avatarRoot.position.add(rigHipPosition.clone().sub(alignedAvatarHips));
  avatarRoot.updateMatrixWorld(true);
  return true;
}

function isLowerBodyBoneName(value: string) {
  const name = cleanName(value);
  if (/arm|hand|finger|thumb|shoulder/.test(name)) return false;
  return /hips|pelvis|upleg|upperleg|thigh|lowerleg|calf|shin|leftleg|rightleg/.test(name);
}

function isFootBoneName(value: string) {
  return /foot|toe/.test(cleanName(value));
}

function vertexWeightForBones(mesh: SkinnedMesh, vertex: number, boneIndexes: Set<number>) {
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight) return 0;
  const indexes = [skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex)];
  const weights = [skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex)];
  let total = 0;
  for (let index = 0; index < indexes.length; index += 1) {
    if (boneIndexes.has(indexes[index])) total += weights[index];
  }
  return total;
}

function clipAvatarBodyUnderBaggy(root: Object3D, category: string | undefined) {
  if (category !== "baggy") return 0;
  let clippedMeshes = 0;

  root.traverse((object: any) => {
    if (!object.isSkinnedMesh) return;
    const mesh = object as SkinnedMesh;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    if (!position || !skinIndex || !skinWeight || !mesh.skeleton?.bones.length) return;

    const lowerIndexes = new Set<number>();
    const footIndexes = new Set<number>();
    mesh.skeleton.bones.forEach((bone, index) => {
      if (isLowerBodyBoneName(bone.name)) lowerIndexes.add(index);
      if (isFootBoneName(bone.name)) footIndexes.add(index);
    });
    if (lowerIndexes.size < 2) return;

    const sourceIndex = geometry.index
      ? Array.from(geometry.index.array as ArrayLike<number>)
      : Array.from({ length: position.count }, (_, index) => index);
    const sourceGroups = geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: sourceIndex.length, materialIndex: 0 }];
    const nextIndex: number[] = [];
    const nextGroups: Array<{ start: number; count: number; materialIndex: number }> = [];

    for (const group of sourceGroups) {
      const start = nextIndex.length;
      const end = Math.min(group.start + group.count, sourceIndex.length);
      for (let offset = group.start; offset + 2 < end; offset += 3) {
        const triangle = [sourceIndex[offset], sourceIndex[offset + 1], sourceIndex[offset + 2]];
        const lowerWeight = triangle.reduce((sum, vertex) => sum + vertexWeightForBones(mesh, vertex, lowerIndexes), 0) / 3;
        const footWeight = triangle.reduce((sum, vertex) => sum + vertexWeightForBones(mesh, vertex, footIndexes), 0) / 3;
        const hideInsidePants = lowerWeight >= 0.34 && footWeight < 0.22;
        if (!hideInsidePants) nextIndex.push(...triangle);
      }
      const count = nextIndex.length - start;
      if (count > 0) nextGroups.push({ start, count, materialIndex: group.materialIndex ?? 0 });
    }

    if (nextIndex.length >= sourceIndex.length * 0.95 || nextIndex.length < 6) return;
    const clipped = geometry.clone();
    clipped.setIndex(new Uint32BufferAttribute(nextIndex, 1));
    clipped.clearGroups();
    nextGroups.forEach((group) => clipped.addGroup(group.start, group.count, group.materialIndex));
    mesh.geometry = clipped;
    mesh.frustumCulled = false;
    geometry.dispose();
    clippedMeshes += 1;
  });

  return clippedMeshes;
}

function rebindAvatarMeshesToRig(avatarRoot: Object3D, rigRoot: Object3D) {
  const rigBones = collectBones(rigRoot);
  let reboundMeshes = 0;

  avatarRoot.updateMatrixWorld(true);
  rigRoot.updateMatrixWorld(true);
  avatarRoot.traverse((object: any) => {
    if (!object.isSkinnedMesh) return;
    const mesh = object as SkinnedMesh;
    const originalBones = mesh.skeleton?.bones ?? [];
    if (originalBones.length === 0) return;

    let mappedCount = 0;
    const mappedBones = originalBones.map((bone) => {
      const mapped = rigBones.get(cleanName(bone.name));
      if (mapped) mappedCount += 1;
      return mapped ?? bone;
    });
    if (mappedCount / originalBones.length < 0.65) return;

    const sharedSkeleton = new Skeleton(mappedBones);
    sharedSkeleton.calculateInverses();
    mesh.bind(sharedSkeleton, mesh.matrixWorld.clone());
    mesh.normalizeSkinWeights();
    mesh.frustumCulled = false;
    reboundMeshes += 1;
  });

  return reboundMeshes;
}

function clipSignature(trackNames: string[]) {
  return trackNames.slice().sort().join("|");
}

function clipMotionScore(clip: AnimationClip) {
  let score = 0;
  for (const track of clip.tracks) {
    const name = cleanName(track.name);
    if (!/hips|pelvis|upleg|upperleg|thigh|lowerleg|calf|shin|arm|shoulder/.test(name)) continue;
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

function stopAction(action: AnimationAction) {
  action.enabled = false;
  action.paused = false;
  action.stop();
}

function startAction(action: AnimationAction) {
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

function snapshotBone(root: Object3D, aliases: string[]): BoneSnapshot | null {
  const bone = findBone(root, aliases);
  return bone ? { bone, quaternion: bone.quaternion.clone(), position: bone.position.clone() } : null;
}

function applyBoneRotation(snapshot: BoneSnapshot | null, angle: number) {
  if (!snapshot) return;
  const rotation = new Quaternion().setFromAxisAngle(X_AXIS, angle);
  snapshot.bone.quaternion.copy(snapshot.quaternion).multiply(rotation);
}

function createProceduralMotion(root: Object3D): ProceduralMotion {
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

function disposeModel(root: Object3D | null) {
  root?.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
    else object.material?.dispose?.();
  });
  root?.removeFromParent();
}

export function ResultRigPreview({ url, showAvatar = true, category, onInfo }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const helperRef = useRef<SkeletonHelper | null>(null);
  const garmentMixerRef = useRef<AnimationMixer | null>(null);
  const avatarMixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, SyncedActionGroup>>(new Map());
  const proceduralMotionsRef = useRef<ProceduralMotion[]>([]);
  const proceduralActiveRef = useRef(false);
  const proceduralTimeRef = useRef(0);
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarUrl = useMemo(() => avatar.modelUrl ?? avatar.fallbackUrl, [avatar.fallbackUrl, avatar.modelUrl]);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [clips, setClips] = useState<ClipOption[]>([]);
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const [replayCount, setReplayCount] = useState(0);
  const [previewStatus, setPreviewStatus] = useState("Tocá Probar movimiento para verificar el rig.");

  useEffect(() => {
    if (helperRef.current) helperRef.current.visible = showSkeleton;
  }, [showSkeleton]);

  function stopAllMotion() {
    for (const group of actionsRef.current.values()) {
      group.garment.forEach(stopAction);
      group.avatar.forEach(stopAction);
    }
    garmentMixerRef.current?.stopAllAction();
    avatarMixerRef.current?.stopAllAction();
    garmentMixerRef.current?.setTime(0);
    avatarMixerRef.current?.setTime(0);
    proceduralActiveRef.current = false;
    proceduralTimeRef.current = 0;
    proceduralMotionsRef.current.forEach((motion) => motion.reset());
  }

  function playClip(id: string) {
    stopAllMotion();
    const option = clips.find((clip) => clip.id === id);
    const selected = actionsRef.current.get(id);

    if (option?.procedural || !selected || selected.motionScore < 0.02) {
      const usable = proceduralMotionsRef.current.some((motion) => motion.usable);
      if (!usable) {
        setPreviewStatus("El rig no expone huesos suficientes para la prueba de movimiento.");
        return;
      }
      proceduralActiveRef.current = true;
      setPreviewStatus("Movimiento de prueba activo: cadera, piernas, rodillas y brazos.");
    } else {
      selected.garment.forEach(startAction);
      selected.avatar.forEach(startAction);
      setPreviewStatus("Animación exportada activa.");
    }

    setActiveClip(id);
    setReplayCount((value) => value + 1);
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !url) {
      onInfo?.({ loading: false, bones: 0, objectMeshName: null, anchorBoneName: null, weightedVertexRatio: null, clips: [] });
      return;
    }

    let disposed = false;
    let raf = 0;
    let rigModel: Object3D | null = null;
    let avatarModel: Object3D | null = null;
    let displayGroup: Group | null = null;
    const clock = new Clock();
    setClips([]);
    setActiveClip(null);
    setReplayCount(0);
    setShowSkeleton(false);
    setPreviewStatus("Tocá Probar movimiento para verificar el rig.");
    actionsRef.current = new Map();
    proceduralMotionsRef.current = [];
    proceduralActiveRef.current = false;
    proceduralTimeRef.current = 0;
    onInfo?.({ loading: true, bones: 0, objectMeshName: null, anchorBoneName: null, weightedVertexRatio: null, clips: [] });

    const scene = new Scene();
    const camera = new PerspectiveCamera(34, 1, 0.01, 200);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.replaceChildren(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x171025, 2));
    scene.add(new AmbientLight(0xffffff, 0.8));
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 5, 4);
    scene.add(key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 0.3;
    controls.maxDistance = 20;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (!displayGroup) return;
      const box = new Box3().setFromObject(displayGroup);
      if (box.isEmpty()) return;
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      const distance = Math.max(size.y, size.x, size.z, 0.5) * 1.45;
      camera.position.set(center.x, center.y + size.y * 0.03, center.z + distance);
      controls.target.copy(center);
      controls.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const avatarPromise = showAvatar && avatarUrl && avatarUrl !== url
      ? loader.loadAsync(avatarUrl).catch((error) => {
          console.warn("Final avatar overlay failed", error);
          return null;
        })
      : Promise.resolve(null);

    void Promise.all([loader.loadAsync(url), avatarPromise]).then(([rigGltf, avatarGltf]) => {
      if (disposed) return;
      rigModel = rigGltf.scene;
      avatarModel = avatarGltf?.scene ?? null;
      displayGroup = new Group();
      displayGroup.name = "CLOUVA_FINAL_DRESSED_PREVIEW";
      displayGroup.rotation.y = Number.isFinite(avatar.frontRotationY) ? avatar.frontRotationY : 0;
      scene.add(displayGroup);

      let reboundMeshes = 0;
      if (avatarModel) {
        hideConflictingAvatarClothes(avatarModel, category);
        alignAvatarToResultRig(avatarModel, rigModel);
        clipAvatarBodyUnderBaggy(avatarModel, category);
        reboundMeshes = rebindAvatarMeshesToRig(avatarModel, rigModel);
        displayGroup.add(avatarModel);
      }
      displayGroup.add(rigModel);
      displayGroup.updateMatrixWorld(true);

      const boneMap = new Map<string, Bone>();
      rigModel.traverse((object: any) => {
        if (object.isBone) boneMap.set(object.uuid, object as Bone);
        if (object.isSkinnedMesh) {
          for (const bone of object.skeleton?.bones ?? []) boneMap.set(bone.uuid, bone as Bone);
        }
      });

      const helper = new SkeletonHelper(rigModel);
      helper.visible = false;
      helperRef.current = helper;
      displayGroup.add(helper);

      const garmentMixer = new AnimationMixer(rigModel);
      const avatarMixer = avatarModel && reboundMeshes === 0 ? new AnimationMixer(avatarModel) : null;
      garmentMixerRef.current = garmentMixer;
      avatarMixerRef.current = avatarMixer;

      const groups = new Map<string, SyncedActionGroup>();
      rigGltf.animations.forEach((clip, index) => {
        if (!(clip.duration > 0) || clip.tracks.length === 0) return;
        const label = friendlyClipLabel(clip.name, index);
        const id = cleanName(label) || `movement${index + 1}`;
        const signature = clipSignature(clip.tracks.map((track) => track.name));
        const group = groups.get(id) ?? {
          garment: [],
          avatar: [],
          signatures: new Set<string>(),
          duration: 0,
          tracks: 0,
          motionScore: 0,
        };
        if (group.signatures.has(signature)) return;
        group.signatures.add(signature);
        group.garment.push(garmentMixer.clipAction(clip));
        if (avatarMixer && avatarModel) group.avatar.push(avatarMixer.clipAction(clip.clone()));
        group.duration = Math.max(group.duration, clip.duration);
        group.tracks += clip.tracks.length;
        group.motionScore += clipMotionScore(clip);
        groups.set(id, group);
      });

      actionsRef.current = groups;
      proceduralMotionsRef.current = [createProceduralMotion(rigModel)];
      if (avatarModel && reboundMeshes === 0) proceduralMotionsRef.current.push(createProceduralMotion(avatarModel));

      const options: ClipOption[] = [{
        id: "procedural-walk-test",
        label: "Probar movimiento",
        duration: 0,
        tracks: 0,
        procedural: true,
      }];
      for (const [id, group] of groups.entries()) {
        if (group.motionScore < 0.02) continue;
        options.push({
          id,
          label: friendlyClipLabel(id, 0),
          duration: group.duration,
          tracks: group.tracks,
        });
      }
      setClips(options);
      setActiveClip(null);

      const objectMesh = findObjectMesh(rigModel);
      const inspection = objectMesh ? inspectAnchorBone(objectMesh) : { anchorBoneName: null, weightedVertexRatio: null };
      onInfo?.({
        loading: false,
        bones: boneMap.size,
        objectMeshName: objectMesh?.name ?? null,
        anchorBoneName: inspection.anchorBoneName,
        weightedVertexRatio: inspection.weightedVertexRatio,
        clips: options.map((option) => option.label),
      });
      resize();
    }).catch((error) => {
      if (disposed) return;
      onInfo?.({
        loading: false,
        bones: 0,
        objectMeshName: null,
        anchorBoneName: null,
        weightedVertexRatio: null,
        clips: [],
        error: error instanceof Error ? error.message : "No se pudo abrir el GLB",
      });
    });

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      garmentMixerRef.current?.update(delta);
      avatarMixerRef.current?.update(delta);
      if (proceduralActiveRef.current) {
        proceduralTimeRef.current += delta;
        proceduralMotionsRef.current.forEach((motion) => motion.update(proceduralTimeRef.current));
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      proceduralMotionsRef.current.forEach((motion) => motion.reset());
      proceduralMotionsRef.current = [];
      proceduralActiveRef.current = false;
      garmentMixerRef.current?.stopAllAction();
      avatarMixerRef.current?.stopAllAction();
      garmentMixerRef.current = null;
      avatarMixerRef.current = null;
      actionsRef.current.clear();
      helperRef.current?.geometry.dispose();
      helperRef.current = null;
      disposeModel(rigModel);
      disposeModel(avatarModel);
      displayGroup?.removeFromParent();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [avatar.frontRotationY, avatarUrl, category, onInfo, showAvatar, url]);

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0817]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-violet-300">Tu avatar vestido</p>
          <p className="text-xs text-white/45">Un solo rig para cuerpo y prenda</p>
        </div>
        <button type="button" onClick={() => setShowSkeleton((value) => !value)} className="rounded-xl border border-white/10 px-3 py-2 text-xs">
          {showSkeleton ? "Ocultar rig" : "Ver rig"}
        </button>
      </div>
      <div ref={mountRef} className="h-[430px] w-full sm:h-[600px]" />
      <div className="border-t border-white/10 p-3">
        <div className="flex gap-2 overflow-x-auto">
          {clips.map((clip) => (
            <button
              key={clip.id}
              type="button"
              onClick={() => playClip(clip.id)}
              aria-pressed={activeClip === clip.id}
              className={`shrink-0 rounded-xl border px-4 py-3 text-xs font-bold transition active:scale-[0.98] ${activeClip === clip.id ? "border-violet-400 bg-violet-500/20 text-white" : "border-white/10 text-white/70"}`}
            >
              {activeClip === clip.id && replayCount > 0 ? "Reiniciar movimiento" : clip.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-white/40">{previewStatus}</p>
      </div>
    </div>
  );
}
