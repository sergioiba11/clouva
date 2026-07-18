"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationMixer,
  Bone,
  Box3,
  Clock,
  DirectionalLight,
  Group,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  SkinnedMesh,
  SRGBColorSpace,
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
};

type SyncedAction = {
  garment: AnimationAction;
  avatar: AnimationAction | null;
};

const HIP_ALIASES = ["hips", "pelvis", "hip", "j_bip_c_hips", "cc_base_hip"];
const LEFT_FOOT_ALIASES = ["leftfoot", "footl", "lfoot", "mixamorigleftfoot", "j_bip_l_foot"];
const RIGHT_FOOT_ALIASES = ["rightfoot", "footr", "rfoot", "mixamorigrightfoot", "j_bip_r_foot"];

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
  if (index === 0 || normalized.includes("baselayer") || normalized.includes("clip0")) return "Probar movimiento";
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
  const delta = rigHipPosition.sub(alignedAvatarHips);
  avatarRoot.position.add(delta);
  avatarRoot.updateMatrixWorld(true);
  return true;
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
  const actionsRef = useRef<Map<string, SyncedAction>>(new Map());
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarUrl = useMemo(() => avatar.modelUrl ?? avatar.fallbackUrl, [avatar.fallbackUrl, avatar.modelUrl]);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [clips, setClips] = useState<ClipOption[]>([]);
  const [activeClip, setActiveClip] = useState<string | null>(null);

  useEffect(() => {
    if (helperRef.current) helperRef.current.visible = showSkeleton;
  }, [showSkeleton]);

  useEffect(() => {
    const actions = actionsRef.current;
    for (const pair of actions.values()) {
      pair.garment.fadeOut(0.18);
      pair.avatar?.fadeOut(0.18);
    }
    if (!activeClip) return;
    const next = actions.get(activeClip);
    next?.garment.reset().fadeIn(0.18).play();
    next?.avatar?.reset().fadeIn(0.18).play();
  }, [activeClip]);

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
    setShowSkeleton(false);
    actionsRef.current = new Map();
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

      if (avatarModel) {
        hideConflictingAvatarClothes(avatarModel, category);
        alignAvatarToResultRig(avatarModel, rigModel);
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
      const avatarMixer = avatarModel ? new AnimationMixer(avatarModel) : null;
      garmentMixerRef.current = garmentMixer;
      avatarMixerRef.current = avatarMixer;
      const actions = new Map<string, SyncedAction>();
      const options: ClipOption[] = [];
      const seenLabels = new Set<string>();
      rigGltf.animations.forEach((clip, index) => {
        const label = friendlyClipLabel(clip.name, index);
        if (seenLabels.has(label)) return;
        seenLabels.add(label);
        const id = `${clip.name || "clip"}:${index}`;
        actions.set(id, {
          garment: garmentMixer.clipAction(clip),
          avatar: avatarMixer && avatarModel ? avatarMixer.clipAction(clip.clone()) : null,
        });
        options.push({ id, label });
      });
      actionsRef.current = actions;
      setClips(options);
      setActiveClip(options[0]?.id ?? null);

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
          <p className="text-xs text-white/45">Prenda, cuerpo y movimiento real de Blender</p>
        </div>
        <button type="button" onClick={() => setShowSkeleton((value) => !value)} className="rounded-xl border border-white/10 px-3 py-2 text-xs">
          {showSkeleton ? "Ocultar rig" : "Ver rig"}
        </button>
      </div>
      <div ref={mountRef} className="h-[430px] w-full sm:h-[600px]" />
      {clips.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-white/10 p-3">
          {clips.map((clip) => (
            <button key={clip.id} type="button" onClick={() => setActiveClip(clip.id)} className={`shrink-0 rounded-xl border px-4 py-3 text-xs font-bold ${activeClip === clip.id ? "border-violet-400 bg-violet-500/20 text-white" : "border-white/10 text-white/50"}`}>
              {clip.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
