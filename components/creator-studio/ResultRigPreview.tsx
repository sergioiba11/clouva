"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationMixer,
  Bone,
  Box3,
  Clock,
  DirectionalLight,
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
  onInfo?: (info: ResultRigInfo) => void;
};

function findObjectMesh(root: Object3D): SkinnedMesh | null {
  const candidates: SkinnedMesh[] = [];
  root.traverse((object: any) => {
    if (object.isSkinnedMesh) candidates.push(object as SkinnedMesh);
  });
  return candidates.find((mesh) => /garment|object|cloth|wearable/i.test(mesh.name)) ?? candidates[0] ?? null;
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

function disposeModel(root: Object3D | null) {
  root?.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
    else object.material?.dispose?.();
  });
  root?.removeFromParent();
}

export function ResultRigPreview({ url, onInfo }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const helperRef = useRef<SkeletonHelper | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, AnimationAction>>(new Map());
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [clips, setClips] = useState<string[]>([]);
  const [activeClip, setActiveClip] = useState<string | null>(null);

  useEffect(() => {
    if (helperRef.current) helperRef.current.visible = showSkeleton;
  }, [showSkeleton]);

  useEffect(() => {
    const actions = actionsRef.current;
    for (const action of actions.values()) action.fadeOut(0.18);
    if (!activeClip) return;
    const next = actions.get(activeClip);
    next?.reset().fadeIn(0.18).play();
  }, [activeClip]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !url) {
      onInfo?.({ loading: false, bones: 0, objectMeshName: null, anchorBoneName: null, weightedVertexRatio: null, clips: [] });
      return;
    }

    let disposed = false;
    let raf = 0;
    let model: Object3D | null = null;
    const clock = new Clock();
    setClips([]);
    setActiveClip(null);
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

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (!model) return;
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      const distance = Math.max(size.y, size.x, size.z, 0.5) * 1.7;
      camera.position.set(center.x, center.y + size.y * 0.05, center.z + distance);
      controls.target.copy(center);
      controls.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    void loader.loadAsync(url).then((gltf) => {
      if (disposed) return;
      model = gltf.scene;
      scene.add(model);
      model.updateMatrixWorld(true);

      const boneMap = new Map<string, Bone>();
      model.traverse((object: any) => {
        if (object.isBone) boneMap.set(object.uuid, object as Bone);
        if (object.isSkinnedMesh) {
          for (const bone of object.skeleton?.bones ?? []) boneMap.set(bone.uuid, bone as Bone);
        }
      });

      const helper = new SkeletonHelper(model);
      helper.visible = showSkeleton && boneMap.size > 0;
      helperRef.current = helper;
      scene.add(helper);

      const mixer = new AnimationMixer(model);
      mixerRef.current = mixer;
      const clipNames = gltf.animations.map((clip, index) => clip.name || `Animación ${index + 1}`);
      const actions = new Map<string, AnimationAction>();
      gltf.animations.forEach((clip, index) => actions.set(clipNames[index], mixer.clipAction(clip)));
      actionsRef.current = actions;
      setClips(clipNames);
      const preferred = clipNames.find((name) => /idle/i.test(name)) ?? clipNames.find((name) => /walk/i.test(name)) ?? clipNames[0] ?? null;
      setActiveClip(preferred);

      const objectMesh = findObjectMesh(model);
      const inspection = objectMesh ? inspectAnchorBone(objectMesh) : { anchorBoneName: null, weightedVertexRatio: null };
      onInfo?.({
        loading: false,
        bones: boneMap.size,
        objectMeshName: objectMesh?.name ?? null,
        anchorBoneName: inspection.anchorBoneName,
        weightedVertexRatio: inspection.weightedVertexRatio,
        clips: clipNames,
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
      mixerRef.current?.update(delta);
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
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      actionsRef.current.clear();
      helperRef.current?.geometry.dispose();
      helperRef.current = null;
      disposeModel(model);
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [url, onInfo]);

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0817]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-violet-300">Resultado real de Blender</p>
          <p className="text-xs text-white/45">Esqueleto, pesos y animaciones exportadas</p>
        </div>
        <button type="button" onClick={() => setShowSkeleton((value) => !value)} className="rounded-xl border border-white/10 px-3 py-2 text-xs">
          {showSkeleton ? "Ocultar huesos" : "Mostrar huesos"}
        </button>
      </div>
      <div ref={mountRef} className="h-[360px] w-full sm:h-[500px]" />
      {clips.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-white/10 p-3">
          {clips.map((clip) => (
            <button key={clip} type="button" onClick={() => setActiveClip(clip)} className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-bold ${activeClip === clip ? "border-violet-400 bg-violet-500/20 text-white" : "border-white/10 text-white/50"}`}>
              {clip}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
