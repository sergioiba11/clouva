"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  Clock,
  DirectionalLight,
  Euler,
  HemisphereLight,
  MathUtils,
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

export type AvatarPoseMode = "idle" | "tpose" | "walk";
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
  poseMode?: AvatarPoseMode;
  onReady?: (object: Object3D) => void;
};

type RigKey = "hips" | "spine" | "chest" | "neck" | "head" | "leftShoulder" | "rightShoulder" | "leftArm" | "rightArm" | "leftForeArm" | "rightForeArm" | "leftUpLeg" | "rightUpLeg" | "leftLeg" | "rightLeg";
type RigBone = { bone: Bone; base: Quaternion };
type Rig = Partial<Record<RigKey, RigBone>>;

const aliases: Record<RigKey, string[]> = {
  hips: ["hips", "pelvis", "jbiphips"],
  spine: ["spine", "spine01", "spine1", "jbipspine"],
  chest: ["spine02", "spine2", "chest", "upperchest", "jbipchest", "jbipupperchest"],
  neck: ["neck", "jbipneck"],
  head: ["head", "jbiphead"],
  leftShoulder: ["leftshoulder", "shoulderl", "claviclel", "leftclavicle", "jbiplshoulder"],
  rightShoulder: ["rightshoulder", "shoulderr", "clavicler", "rightclavicle", "jbiprshoulder"],
  leftArm: ["leftarm", "upperarml", "upperarmleft", "leftupperarm", "jbiplupperarm"],
  rightArm: ["rightarm", "upperarmr", "upperarmright", "rightupperarm", "jbiprupperarm"],
  leftForeArm: ["leftforearm", "forearml", "lowerarml", "leftlowerarm", "jbipllowerarm"],
  rightForeArm: ["rightforearm", "forearmr", "lowerarmr", "rightlowerarm", "jbiprlowerarm"],
  leftUpLeg: ["leftupleg", "thighl", "upperlegl", "leftupperleg", "jbiplupperleg"],
  rightUpLeg: ["rightupleg", "thighr", "upperlegr", "rightupperleg", "jbiprupperleg"],
  leftLeg: ["leftleg", "calfl", "lowerlegl", "shinl", "leftlowerleg", "jbipllowerleg"],
  rightLeg: ["rightleg", "calfr", "lowerlegr", "shinr", "rightlowerleg", "jbiprlowerleg"],
};

function clean(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function collectRig(root: Object3D): Rig {
  const bones: Bone[] = [];
  root.traverse((object) => {
    const bone = object as Bone;
    if (bone.isBone) bones.push(bone);
  });
  const rig: Rig = {};
  for (const key of Object.keys(aliases) as RigKey[]) {
    const names = aliases[key];
    const bone = bones.find((candidate) => names.includes(clean(candidate.name)))
      ?? bones.find((candidate) => names.some((name) => clean(candidate.name).includes(name)));
    if (bone) rig[key] = { bone, base: bone.quaternion.clone() };
  }
  return rig;
}

const euler = new Euler();
const quaternion = new Quaternion();
function poseBone(entry: RigBone | undefined, x: number, y: number, z: number) {
  if (!entry) return;
  euler.set(x, y, z, "XYZ");
  quaternion.setFromEuler(euler);
  entry.bone.quaternion.copy(entry.base).multiply(quaternion);
}

function idlePose(rig: Rig, elapsed: number) {
  const breath = Math.sin(elapsed * 1.5);
  poseBone(rig.chest, breath * 0.014, 0, 0);
  poseBone(rig.head, breath * 0.008, 0, 0);
  poseBone(rig.leftArm, -0.02, 0, 0.1);
  poseBone(rig.rightArm, -0.02, 0, -0.1);
  poseBone(rig.leftForeArm, 0, 0, 0.04);
  poseBone(rig.rightForeArm, 0, 0, -0.04);
  poseBone(rig.leftUpLeg, 0, 0, 0);
  poseBone(rig.rightUpLeg, 0, 0, 0);
}

function tPose(rig: Rig) {
  idlePose(rig, 0);
  poseBone(rig.leftShoulder, 0, 0, 0.04);
  poseBone(rig.rightShoulder, 0, 0, -0.04);
  poseBone(rig.leftArm, 0, 0, Math.PI / 2 - 0.05);
  poseBone(rig.rightArm, 0, 0, -Math.PI / 2 + 0.05);
  poseBone(rig.leftForeArm, 0, 0, 0);
  poseBone(rig.rightForeArm, 0, 0, 0);
}

function walkPose(rig: Rig, elapsed: number) {
  const step = Math.sin(elapsed * 4.2);
  const clamp = (value: number, min: number, max: number) => MathUtils.clamp(value, min, max);
  poseBone(rig.leftArm, clamp(-step * 0.32, -0.34, 0.34), 0, 0.1);
  poseBone(rig.rightArm, clamp(step * 0.32, -0.34, 0.34), 0, -0.1);
  poseBone(rig.leftForeArm, 0, 0, 0.08);
  poseBone(rig.rightForeArm, 0, 0, -0.08);
  poseBone(rig.leftUpLeg, clamp(step * 0.3, -0.32, 0.32), 0, 0);
  poseBone(rig.rightUpLeg, clamp(-step * 0.3, -0.32, 0.32), 0, 0);
  poseBone(rig.leftLeg, Math.max(0, -step) * 0.22, 0, 0);
  poseBone(rig.rightLeg, Math.max(0, step) * 0.22, 0, 0);
}

function clipFor(clips: AnimationClip[], mode: AvatarPoseMode) {
  const keywords = mode === "walk" ? ["walk", "walking", "jog", "run"] : ["idle", "breath", "stand"];
  return clips.find((clip) => keywords.some((keyword) => clean(clip.name).includes(keyword))) ?? null;
}

export function AvatarModelViewer({ modelUrl, fallbackModelUrl = null, modelData, frontRotationY = 0, config, alt, className = "", playAnimations = true, motionTest = false, poseMode = "idle", onReady }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const poseRef = useRef<AvatarPoseMode>(poseMode);
  const motionRef = useRef(motionTest);
  const readyRef = useRef(onReady);
  const [state, setState] = useState<ModelState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => { poseRef.current = poseMode; }, [poseMode]);
  useEffect(() => { motionRef.current = motionTest; }, [motionTest]);
  useEffect(() => { readyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    if (!mount.current) return;
    let disposed = false;
    let raf = 0;
    let model: Object3D | null = null;
    let rig: Rig = {};
    let baseY = 0;
    let clips: AnimationClip[] = [];
    let mixer: AnimationMixer | null = null;
    let activeAction: AnimationAction | null = null;
    let activeMode: AvatarPoseMode | null = null;
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
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener("start", () => { controls.autoRotate = false; if (resumeTimer) clearTimeout(resumeTimer); });
    controls.addEventListener("end", () => { resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 2600); });

    const resize = () => {
      const rect = mount.current?.getBoundingClientRect();
      if (!rect) return;
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
      if (model) {
        const framed = frameAvatar(camera, model, Math.max(rect.width, 1) / Math.max(rect.height, 1), 1.28);
        controls.target.copy(framed.center);
        controls.minDistance = Math.max(framed.distance * 0.72, 1.1);
        controls.maxDistance = framed.distance * 1.75;
        controls.update();
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount.current);
    window.addEventListener("resize", resize);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const attach = (object: Object3D, animations: AnimationClip[], fallback: boolean) => {
      if (disposed) return;
      normalizeAvatarObject(object, { targetHeight: 2.05, frontRotationY });
      object.traverse((child: any) => {
        if (child.isMesh || child.isSkinnedMesh) {
          child.visible = true;
          child.frustumCulled = false;
          child.castShadow = true;
          child.receiveShadow = true;
          child.normalizeSkinWeights?.();
        }
      });
      model = object;
      baseY = object.position.y;
      clips = animations;
      rig = collectRig(object);
      mixer = clips.length ? new AnimationMixer(object) : null;
      scene.add(object);
      setState(fallback ? "fallback" : "ready");
      setErrorMessage(null);
      readyRef.current?.(object);
      requestAnimationFrame(resize);
    };

    const loadUrl = async (url: string, fallback: boolean) => {
      const gltf = await loader.loadAsync(url);
      attach(gltf.scene, gltf.animations, fallback);
    };

    const technicalFallback = () => {
      if (!config) { setState("error"); return; }
      attach(buildProceduralClouvaAvatar(config), [], true);
    };

    void (async () => {
      setState("loading");
      try {
        if (modelData) {
          const gltf = await loader.parseAsync(modelData.slice(0), "");
          attach(gltf.scene, gltf.animations, false);
        } else if (modelUrl) await loadUrl(modelUrl, false);
        else if (fallbackModelUrl) await loadUrl(fallbackModelUrl, true);
        else technicalFallback();
      } catch (error) {
        console.warn("Avatar load failed", error);
        setErrorMessage(error instanceof Error ? error.message : String(error));
        technicalFallback();
      }
    })();

    const selectAction = (mode: AvatarPoseMode) => {
      if (!playAnimations || !mixer || mode === "tpose") return null;
      const clip = clipFor(clips, mode);
      return clip ? mixer.clipAction(clip) : null;
    };

    const animate = () => {
      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;
      const mode = motionRef.current ? "walk" : poseRef.current;

      if (mode !== activeMode) {
        activeAction?.fadeOut(0.15);
        activeAction = selectAction(mode);
        activeAction?.reset().fadeIn(0.15).play();
        activeMode = mode;
      }

      if (activeAction && mixer) mixer.update(delta);
      else if (model) {
        if (mode === "tpose") tPose(rig);
        else if (mode === "walk") walkPose(rig, elapsed);
        else idlePose(rig, elapsed);
      }

      if (model) {
        const breath = mode === "idle" ? Math.sin(elapsed * 1.5) : 0;
        model.position.y = baseY + breath * 0.0025 + (mode === "walk" ? Math.abs(Math.sin(elapsed * 4.2)) * 0.006 : 0);
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (resumeTimer) clearTimeout(resumeTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      activeAction?.stop();
      mixer?.stopAllAction();
      controls.dispose();
      renderer.dispose();
      mount.current?.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, modelData, frontRotationY, playAnimations, config]);

  return (
    <div className={`avatar-render-shell ${className}`} data-state={state} data-avatar-source={state === "ready" ? "glb" : "fallback"} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }} aria-label={alt}>
      {state === "loading" ? <div className="avatar-loader">Cargando CLOUVA…</div> : null}
      {state === "error" ? <div className="avatar-loader" style={{ maxWidth: "88vw", textAlign: "center", zIndex: 30 }}>Error de avatar: {errorMessage}</div> : null}
      <div ref={mount} className="avatar-model-viewer" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh", touchAction: "none" }} />
    </div>
  );
}
