"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  Group,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { alignRigToActiveAvatar } from "./result-rig-runtime-alignment";
import {
  RIG_ERROR,
  animatedGarmentBounds,
  bindGarmentToAvatar,
  boxDiagnostics,
  clipMotionScore,
  clipSignature,
  cleanName,
  collectBones,
  compareBindPose,
  createProceduralMotion,
  disposeModel,
  findObjectMesh,
  friendlyClipLabel,
  inspectAnchorBone,
  isIdentityRoot,
  prepareAvatarMeshes,
  startAction,
  stopAction,
  transformDiagnostics,
  validateBounds,
  visibleMeshBounds,
  type ProceduralMotion,
} from "./result-rig-v39-core";

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

type MotionActionGroup = {
  actions: AnimationAction[];
  signatures: Set<string>;
  duration: number;
  tracks: number;
  motionScore: number;
};

export function ResultRigPreview({ url, showAvatar = true, category, onInfo }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const helperRef = useRef<SkeletonHelper | null>(null);
  const motionMixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, MotionActionGroup>>(new Map());
  const proceduralMotionRef = useRef<ProceduralMotion | null>(null);
  const proceduralActiveRef = useRef(false);
  const proceduralTimeRef = useRef(0);
  const motionValidationRef = useRef(false);
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
    for (const group of actionsRef.current.values()) group.actions.forEach(stopAction);
    motionMixerRef.current?.stopAllAction();
    motionMixerRef.current?.setTime(0);
    proceduralActiveRef.current = false;
    proceduralTimeRef.current = 0;
    motionValidationRef.current = false;
    proceduralMotionRef.current?.reset();
  }

  function playClip(id: string) {
    stopAllMotion();
    const option = clips.find((clip) => clip.id === id);
    const selected = actionsRef.current.get(id);
    if (option?.procedural || !selected || selected.motionScore < 0.02) {
      if (!proceduralMotionRef.current?.usable) {
        setPreviewStatus("El avatar activo no expone huesos suficientes para la prueba de movimiento.");
        return;
      }
      proceduralActiveRef.current = true;
      setPreviewStatus("Movimiento de prueba activo: el avatar conduce y la prenda usa su mismo esqueleto.");
    } else {
      selected.actions.forEach(startAction);
      setPreviewStatus("Animación activa sobre el esqueleto único del avatar.");
    }
    motionValidationRef.current = true;
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
    let frame = 0;
    let rejected = false;
    let rigStage = "carga";
    let rigModel: Object3D | null = null;
    let avatarModel: Object3D | null = null;
    let displayGroup: Group | null = null;
    let avatarBounds = new Box3();
    let avatarHeight = 0;
    const clock = new Clock();

    setClips([]);
    setActiveClip(null);
    setReplayCount(0);
    setShowSkeleton(false);
    setPreviewStatus("Cargando avatar activo y prenda riggeada…");
    actionsRef.current = new Map();
    proceduralMotionRef.current = null;
    proceduralActiveRef.current = false;
    proceduralTimeRef.current = 0;
    motionValidationRef.current = false;
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

    const resizeViewport = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const fitCameraOnce = (box: Box3) => {
      if (box.isEmpty()) return;
      resizeViewport();
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      const verticalFov = camera.fov * Math.PI / 180;
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const desiredFill = 0.70;
      const verticalDistance = size.y / Math.max(2 * Math.tan(verticalFov / 2) * desiredFill, 1e-5);
      const horizontalDistance = size.x / Math.max(2 * Math.tan(horizontalFov / 2) * desiredFill, 1e-5);
      const distance = Math.max(verticalDistance, horizontalDistance) + size.z * 0.5;
      camera.position.set(center.x, center.y + size.y * 0.02, center.z + distance);
      camera.near = Math.max(distance / 100, 0.01);
      camera.far = Math.max(distance + Math.max(size.x, size.y, size.z) * 20, 20);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = Math.max(distance * 0.35, 0.15);
      controls.maxDistance = Math.max(distance * 4, 5);
      controls.update();
    };

    const rejectRig = (message = RIG_ERROR) => {
      if (rejected) return;
      rejected = true;
      stopAllMotion();
      if (rigModel) rigModel.visible = false;
      setClips([]);
      setPreviewStatus(message);
      onInfo?.({
        loading: false,
        bones: avatarModel ? collectBones(avatarModel).size : 0,
        objectMeshName: null,
        anchorBoneName: null,
        weightedVertexRatio: null,
        clips: [],
        error: message,
      });
    };

    const observer = new ResizeObserver(resizeViewport);
    observer.observe(mount);
    resizeViewport();

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const avatarPromise = showAvatar
      ? avatarUrl && avatarUrl !== url
        ? loader.loadAsync(avatarUrl)
        : Promise.reject(new Error("No hay un avatar activo disponible para vestir."))
      : Promise.resolve(null);

    void Promise.all([loader.loadAsync(url), avatarPromise]).then(([rigGltf, avatarGltf]) => {
      if (disposed) return;
      const rigScene = rigGltf.scene;
      const avatarScene = avatarGltf?.scene ?? null;
      rigModel = rigScene;
      avatarModel = avatarScene;
      if (!avatarScene) throw new Error("No hay un avatar activo disponible para vestir.");

      displayGroup = new Group();
      displayGroup.name = "CLOUVA_FINAL_DRESSED_PREVIEW";
      displayGroup.rotation.y = Number.isFinite(avatar.frontRotationY) ? avatar.frontRotationY : 0;
      scene.add(displayGroup);

      rigStage = "alineación con el avatar activo";
      prepareAvatarMeshes(avatarScene, category);
      avatarScene.updateMatrixWorld(true);
      rigScene.updateMatrixWorld(true);
      const exportedTransform = transformDiagnostics(rigScene);
      const exportedRootWasIdentity = isIdentityRoot(rigScene);
      const alignment = alignRigToActiveAvatar(rigScene, avatarScene);

      displayGroup.add(avatarScene);
      displayGroup.add(rigScene);
      displayGroup.updateMatrixWorld(true);

      rigStage = "encuadre del avatar";
      avatarBounds = visibleMeshBounds(avatarScene).clone();
      if (avatarBounds.isEmpty()) throw new Error("El avatar activo no contiene una malla visible.");
      fitCameraOnce(avatarBounds);

      rigStage = "validación de escala";
      const initialGarmentBounds = visibleMeshBounds(rigScene);
      const bounds = validateBounds(avatarBounds, initialGarmentBounds);
      avatarHeight = bounds.avatarHeight;

      rigStage = "validación de bind pose";
      const bindPose = compareBindPose(avatarScene, rigScene, avatarHeight);

      rigStage = "enlace al esqueleto único";
      const shared = bindGarmentToAvatar(rigScene, avatarScene);
      const postBindBounds = animatedGarmentBounds(rigScene);
      validateBounds(avatarBounds, postBindBounds);

      const primaryBones = collectBones(avatarScene);
      const helper = new SkeletonHelper(avatarScene);
      helper.visible = false;
      helperRef.current = helper;
      displayGroup.add(helper);

      const mixer = new AnimationMixer(avatarScene);
      motionMixerRef.current = mixer;
      const sourceClips = avatarGltf?.animations?.length ? avatarGltf.animations : rigGltf.animations;
      const groups = new Map<string, MotionActionGroup>();
      sourceClips.forEach((clip, index) => {
        if (!(clip.duration > 0) || !clip.tracks.length) return;
        const label = friendlyClipLabel(clip.name, index);
        const id = cleanName(label) || `movement${index + 1}`;
        const signature = clipSignature(clip.tracks.map((track) => track.name));
        const group = groups.get(id) ?? { actions: [], signatures: new Set<string>(), duration: 0, tracks: 0, motionScore: 0 };
        if (group.signatures.has(signature)) return;
        group.signatures.add(signature);
        group.actions.push(mixer.clipAction(clip.clone()));
        group.duration = Math.max(group.duration, clip.duration);
        group.tracks += clip.tracks.length;
        group.motionScore += clipMotionScore(clip);
        groups.set(id, group);
      });
      actionsRef.current = groups;
      proceduralMotionRef.current = createProceduralMotion(avatarScene);

      const options: ClipOption[] = [{ id: "procedural-walk-test", label: "Probar movimiento", duration: 0, tracks: 0, procedural: true }];
      for (const [id, group] of groups) {
        if (group.motionScore < 0.02) continue;
        options.push({ id, label: friendlyClipLabel(id, 0), duration: group.duration, tracks: group.tracks });
      }
      setClips(options);
      setActiveClip(null);
      setPreviewStatus(`Avatar completo cargado; ${shared.mappedBones}/${shared.totalBones} huesos comparten el esqueleto oficial.`);

      const objectMesh = findObjectMesh(rigScene);
      const inspection = objectMesh ? inspectAnchorBone(objectMesh) : { anchorBoneName: null, weightedVertexRatio: null };
      console.info("[CLOUVA rig diagnostics]", {
        avatarRoot: transformDiagnostics(avatarScene),
        exportedGarmentRoot: exportedTransform,
        exportedRootWasIdentity,
        runtimeAlignment: alignment,
        alignedGarmentRoot: transformDiagnostics(rigScene),
        avatarBounds: boxDiagnostics(avatarBounds),
        garmentBounds: boxDiagnostics(initialGarmentBounds),
        postBindBounds: boxDiagnostics(postBindBounds),
        bindPose,
        shared,
      });
      onInfo?.({
        loading: false,
        bones: primaryBones.size,
        objectMeshName: objectMesh?.name ?? null,
        anchorBoneName: inspection.anchorBoneName,
        weightedVertexRatio: inspection.weightedVertexRatio,
        clips: options.map((option) => option.label),
      });
    }).catch((error) => {
      if (disposed) return;
      console.error("[CLOUVA rig rejected]", { stage: rigStage, error });
      rejectRig(error instanceof Error ? error.message : "No se pudo abrir el GLB");
    });

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!rejected) {
        motionMixerRef.current?.update(delta);
        if (proceduralActiveRef.current) {
          proceduralTimeRef.current += delta;
          proceduralMotionRef.current?.update(proceduralTimeRef.current);
        }
        if (motionValidationRef.current && rigModel && avatarHeight > 0 && frame % 20 === 0) {
          try {
            validateBounds(avatarBounds, animatedGarmentBounds(rigModel));
          } catch {
            rejectRig(RIG_ERROR);
          }
        }
      }
      frame += 1;
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
      proceduralMotionRef.current?.reset();
      proceduralMotionRef.current = null;
      proceduralActiveRef.current = false;
      motionMixerRef.current?.stopAllAction();
      motionMixerRef.current = null;
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
          <p className="text-xs text-white/45">Avatar principal + prenda sobre el mismo esqueleto</p>
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
