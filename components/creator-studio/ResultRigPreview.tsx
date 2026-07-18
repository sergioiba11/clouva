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
  LoopRepeat,
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
  duration: number;
  tracks: number;
};

type SyncedActionGroup = {
  garment: AnimationAction[];
  avatar: AnimationAction[];
  signatures: Set<string>;
  duration: number;
  tracks: number;
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
  avatarRoot.position.add(rigHipPosition.clone().sub(alignedAvatarHips));
  avatarRoot.updateMatrixWorld(true);
  return true;
}

function clipSignature(trackNames: string[]) {
  return trackNames.slice().sort().join("|");
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
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarUrl = useMemo(() => avatar.modelUrl ?? avatar.fallbackUrl, [avatar.fallbackUrl, avatar.modelUrl]);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [clips, setClips] = useState<ClipOption[]>([]);
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const [replayCount, setReplayCount] = useState(0);

  useEffect(() => {
    if (helperRef.current) helperRef.current.visible = showSkeleton;
  }, [showSkeleton]);

  function playClip(id: string) {
    const selected = actionsRef.current.get(id);
    if (!selected) return;

    for (const group of actionsRef.current.values()) {
      group.garment.forEach(stopAction);
      group.avatar.forEach(stopAction);
    }

    garmentMixerRef.current?.stopAllAction();
    avatarMixerRef.current?.stopAllAction();
    garmentMixerRef.current?.setTime(0);
    avatarMixerRef.current?.setTime(0);

    selected.garment.forEach(startAction);
    selected.avatar.forEach(startAction);
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
        };
        if (group.signatures.has(signature)) return;
        group.signatures.add(signature);
        group.garment.push(garmentMixer.clipAction(clip));
        if (avatarMixer && avatarModel) group.avatar.push(avatarMixer.clipAction(clip.clone()));
        group.duration = Math.max(group.duration, clip.duration);
        group.tracks += clip.tracks.length;
        groups.set(id, group);
      });

      actionsRef.current = groups;
      const options = [...groups.entries()].map(([id, group]) => ({
        id,
        label: id === "probarmovimiento" ? "Probar movimiento" : friendlyClipLabel(id, 0),
        duration: group.duration,
        tracks: group.tracks,
      }));
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
          <p className="mt-2 text-[11px] text-white/35">
            {activeClip ? "Movimiento activo. Tocá otra vez para reiniciarlo desde el comienzo." : "Tocá el botón para iniciar la animación."}
          </p>
        </div>
      ) : (
        <div className="border-t border-white/10 p-3 text-xs text-amber-200/70">Este GLB no contiene un clip de movimiento reproducible.</div>
      )}
    </div>
  );
}
