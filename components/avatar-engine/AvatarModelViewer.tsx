"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Clock,
  DirectionalLight,
  Euler,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { frameAvatar, normalizeAvatarObject } from "@/lib/avatar-engine/frame-avatar";
import { buildProceduralClouvaAvatar } from "@/lib/avatar-engine/procedural-clouva";
import type { AvatarConfig } from "@/lib/avatar-engine/types";

type ModelState = "loading" | "ready" | "fallback" | "error";
type Props = {
  modelUrl: string | null;
  fallbackModelUrl?: string | null;
  modelData?: ArrayBuffer | null;
  frontRotationY?: number;
  config?: AvatarConfig;
  alt?: string;
  className?: string;
  playAnimations?: boolean;
  motionTest?: boolean;
  onReady?: (object: Object3D) => void;
};

const BONE_ALIASES = {
  hips: ["Hips", "mixamorig:Hips", "pelvis", "Pelvis"],
  spine: ["Spine", "Spine01", "Spine1", "mixamorig:Spine"],
  chest: ["Spine02", "Spine2", "mixamorig:Spine2", "Chest", "chest"],
  neck: ["Neck", "neck", "mixamorig:Neck"],
  head: ["Head", "head", "mixamorig:Head"],
  leftShoulder: ["LeftShoulder", "mixamorig:LeftShoulder", "shoulder.L", "Shoulder_L"],
  rightShoulder: ["RightShoulder", "mixamorig:RightShoulder", "shoulder.R", "Shoulder_R"],
  leftArm: ["LeftArm", "mixamorig:LeftArm", "upper_arm.L", "UpperArm_L"],
  rightArm: ["RightArm", "mixamorig:RightArm", "upper_arm.R", "UpperArm_R"],
  leftForeArm: ["LeftForeArm", "mixamorig:LeftForeArm", "forearm.L", "LowerArm_L"],
  rightForeArm: ["RightForeArm", "mixamorig:RightForeArm", "forearm.R", "LowerArm_R"],
  leftUpLeg: ["LeftUpLeg", "mixamorig:LeftUpLeg", "thigh.L", "UpperLeg_L"],
  rightUpLeg: ["RightUpLeg", "mixamorig:RightUpLeg", "thigh.R", "UpperLeg_R"],
} as const;

type BoneKey = keyof typeof BONE_ALIASES;
type RigBone = { object: Object3D; base: Quaternion };
type ProceduralRig = Partial<Record<BoneKey, RigBone>>;

function findBone(root: Object3D, aliases: readonly string[]) {
  let result: Object3D | null = null;
  root.traverse((object) => {
    if (!result && aliases.includes(object.name)) result = object;
  });
  return result;
}

function collectRig(root: Object3D): ProceduralRig {
  const rig: ProceduralRig = {};
  for (const [key, aliases] of Object.entries(BONE_ALIASES) as [BoneKey, readonly string[]][]) {
    const object = findBone(root, aliases);
    if (object) rig[key] = { object, base: object.quaternion.clone() };
  }
  return rig;
}

const idleEuler = new Euler();
const idleQuaternion = new Quaternion();
function poseBone(bone: RigBone | undefined, x: number, y: number, z: number) {
  if (!bone) return;
  idleEuler.set(x, y, z, "XYZ");
  idleQuaternion.setFromEuler(idleEuler);
  bone.object.quaternion.copy(bone.base).multiply(idleQuaternion);
}

function applyProceduralIdle(rig: ProceduralRig, time: number, motionTest: boolean) {
  const breath = Math.sin(time * 1.55);
  const slow = Math.sin(time * 0.55);
  const sway = Math.sin(time * 0.34);
  poseBone(rig.spine, breath * 0.006, 0, 0);
  poseBone(rig.chest, breath * 0.014, 0, 0);
  poseBone(rig.leftShoulder, 0, 0, breath * 0.006);
  poseBone(rig.rightShoulder, 0, 0, -breath * 0.006);
  if (!motionTest) {
    poseBone(rig.hips, 0, 0, 0);
    poseBone(rig.neck, 0, 0, 0);
    poseBone(rig.head, 0, 0, 0);
    poseBone(rig.leftArm, 0, 0, 0);
    poseBone(rig.rightArm, 0, 0, 0);
    poseBone(rig.leftForeArm, 0, 0, 0);
    poseBone(rig.rightForeArm, 0, 0, 0);
    poseBone(rig.leftUpLeg, 0, 0, 0);
    poseBone(rig.rightUpLeg, 0, 0, 0);
    return;
  }
  poseBone(rig.hips, 0, sway * 0.035, slow * 0.018);
  poseBone(rig.neck, -breath * 0.006, sway * 0.035, slow * 0.012);
  poseBone(rig.head, breath * 0.006, sway * 0.055, slow * 0.018);
  poseBone(rig.leftArm, breath * 0.02, 0, 0.12 + slow * 0.045);
  poseBone(rig.rightArm, breath * 0.02, 0, -0.12 - slow * 0.045);
  poseBone(rig.leftForeArm, 0, slow * 0.04, 0.08 + breath * 0.025);
  poseBone(rig.rightForeArm, 0, -slow * 0.04, -0.08 - breath * 0.025);
  poseBone(rig.leftUpLeg, slow * 0.018, 0, sway * 0.012);
  poseBone(rig.rightUpLeg, -slow * 0.018, 0, -sway * 0.012);
}

export function AvatarModelViewer({
  modelUrl,
  fallbackModelUrl = null,
  modelData,
  frontRotationY = 0,
  config,
  className = "",
  playAnimations = true,
  motionTest = false,
  onReady,
}: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ModelState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!mount.current) return;
    let disposed = false;
    let raf = 0;
    let currentModel: Object3D | null = null;
    let baseY = 0;
    let proceduralRig: ProceduralRig = {};
    let mixer: AnimationMixer | null = null;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const clock = new Clock();
    const scene = new Scene();
    const camera = new PerspectiveCamera(31, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5));
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    mount.current.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x160b25, 2.25));
    scene.add(new AmbientLight(0xffffff, 0.95));
    const key = new DirectionalLight(0xffffff, 3.1); key.position.set(3, 5, 4); scene.add(key);
    const rim = new DirectionalLight(0x8b5cf6, 2.1); rim.position.set(-3, 2.5, -3); scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.82;
    controls.minPolarAngle = Math.PI * 0.2;
    controls.maxPolarAngle = Math.PI * 0.78;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener("start", () => { controls.autoRotate = false; if (resumeTimer) clearTimeout(resumeTimer); });
    controls.addEventListener("end", () => { resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 2600); });

    const resize = () => {
      const rect = mount.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.max(rect.width, 1); const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      if (currentModel) {
        const framed = frameAvatar(camera, currentModel, width / height, 1.28);
        controls.target.copy(framed.center);
        controls.minDistance = Math.max(framed.distance * 0.72, 1.1);
        controls.maxDistance = framed.distance * 1.75;
        controls.update();
      } else { camera.aspect = width / height; camera.updateProjectionMatrix(); }
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(mount.current); window.addEventListener("resize", resize);

    const loader = new GLTFLoader();
    let loaderReady: Promise<void> = Promise.resolve();
    if (MeshoptDecoder && typeof (MeshoptDecoder as any).ready?.then === "function") loaderReady = (MeshoptDecoder as any).ready.then(() => loader.setMeshoptDecoder(MeshoptDecoder));
    else loader.setMeshoptDecoder(MeshoptDecoder);

    const attachModel = (object: Object3D, animations: any[], isFallback: boolean) => {
      if (disposed) return;
      normalizeAvatarObject(object, { targetHeight: 2.05, frontRotationY });
      object.traverse((child: any) => { if (child.isMesh || child.isSkinnedMesh) { child.visible = true; child.frustumCulled = false; child.castShadow = true; child.receiveShadow = true; } });
      currentModel = object;
      baseY = object.position.y;
      proceduralRig = collectRig(object);
      scene.add(object);
      if (playAnimations && animations.length) {
        mixer = new AnimationMixer(object);
        const idle = animations.find((clip) => String(clip.name).toLowerCase() === "idle") ?? animations.find((clip) => String(clip.name).toLowerCase().includes("idle"));
        if (idle) mixer.clipAction(idle).reset().play();
      }
      setState(isFallback ? "fallback" : "ready"); setErrorMessage(null); if (!isFallback) onReady?.(object); requestAnimationFrame(resize);
    };
    const loadUrl = async (url: string, isFallback: boolean) => { await loaderReady; const gltf = await loader.loadAsync(url); attachModel(gltf.scene, gltf.animations, isFallback); };
    const useTechnicalFallback = () => { if (!config) { setState("error"); return; } attachModel(buildProceduralClouvaAvatar(config), [], true); };
    const load = async () => {
      setState("loading"); setErrorMessage(null);
      try {
        if (modelData) { await loaderReady; const gltf = await loader.parseAsync(modelData.slice(0), ""); attachModel(gltf.scene, gltf.animations, false); return; }
        if (modelUrl) { await loadUrl(modelUrl, false); return; }
      } catch (primaryError) {
        console.warn("Primary avatar failed", primaryError);
        if (fallbackModelUrl && fallbackModelUrl !== modelUrl) {
          try { await loadUrl(fallbackModelUrl, true); return; } catch (fallbackError) { console.error("Temporary rig failed", fallbackError); setErrorMessage(fallbackError instanceof Error ? fallbackError.message : String(fallbackError)); }
        } else setErrorMessage(primaryError instanceof Error ? primaryError.message : String(primaryError));
        useTechnicalFallback();
      }
    };
    void load();

    const animate = () => {
      if (!document.hidden) {
        const delta = clock.getDelta();
        const elapsed = clock.elapsedTime;
        mixer?.update(delta);
        if (!mixer && currentModel) {
          applyProceduralIdle(proceduralRig, elapsed, motionTest);
          currentModel.position.y = baseY + Math.sin(elapsed * 1.55) * (motionTest ? 0.006 : 0.0025);
        }
        controls.update(); renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true; cancelAnimationFrame(raf); if (resumeTimer) clearTimeout(resumeTimer); resizeObserver.disconnect(); window.removeEventListener("resize", resize); mixer?.stopAllAction(); controls.dispose(); renderer.dispose(); mount.current?.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, modelData, frontRotationY, playAnimations, motionTest]);

  return <div className={`avatar-render-shell ${className}`} data-state={state} data-avatar-source={state === "ready" ? "glb" : "fallback"} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}>
    {state === "loading" ? <div className="avatar-loader">Cargando CLOUVA…</div> : null}
    {state === "error" ? <div className="avatar-loader" style={{ maxWidth: "88vw", textAlign: "center", zIndex: 30 }}>Error de avatar: {errorMessage}</div> : null}
    <div ref={mount} className="avatar-model-viewer" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh", touchAction: "none" }} />
  </div>;
}
