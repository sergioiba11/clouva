"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
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

type ModelState = "loading" | "ready" | "fallback" | "error";
export type AvatarPoseMode = "idle" | "tpose" | "walk";

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

type RigKey =
  | "hips" | "spine" | "chest" | "neck" | "head"
  | "leftShoulder" | "rightShoulder" | "leftArm" | "rightArm"
  | "leftForeArm" | "rightForeArm" | "leftUpLeg" | "rightUpLeg"
  | "leftLeg" | "rightLeg";

type RigBone = { bone: Bone; base: Quaternion };
type DanceRig = Partial<Record<RigKey, RigBone>>;

const RIG_ALIASES: Record<RigKey, readonly string[]> = {
  hips: ["hips", "pelvis"],
  spine: ["spine", "spine01", "spine1"],
  chest: ["spine02", "spine2", "chest", "upperchest"],
  neck: ["neck"],
  head: ["head"],
  leftShoulder: ["leftshoulder", "shoulderl", "claviclel", "leftclavicle"],
  rightShoulder: ["rightshoulder", "shoulderr", "clavicler", "rightclavicle"],
  leftArm: ["leftarm", "upperarml", "upperarmleft"],
  rightArm: ["rightarm", "upperarmr", "upperarmright"],
  leftForeArm: ["leftforearm", "forearml", "lowerarml"],
  rightForeArm: ["rightforearm", "forearmr", "lowerarmr"],
  leftUpLeg: ["leftupleg", "thighl", "upperlegl"],
  rightUpLeg: ["rightupleg", "thighr", "upperlegr"],
  leftLeg: ["leftleg", "calfl", "lowerlegl", "shinl"],
  rightLeg: ["rightleg", "calfr", "lowerlegr", "shinr"],
};

function cleanName(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function collectRig(root: Object3D): DanceRig {
  const candidates: Bone[] = [];
  root.traverse((object) => {
    const bone = object as Bone;
    if (bone.isBone) candidates.push(bone);
  });
  const rig: DanceRig = {};
  for (const key of Object.keys(RIG_ALIASES) as RigKey[]) {
    const aliases = RIG_ALIASES[key];
    const exact = candidates.find((bone) => aliases.includes(cleanName(bone.name)));
    const partial = candidates.find((bone) => {
      const name = cleanName(bone.name);
      return aliases.some((alias) => name.includes(alias) || alias.includes(name));
    });
    const bone = exact ?? partial;
    if (bone) rig[key] = { bone, base: bone.quaternion.clone() };
  }
  return rig;
}

const poseEuler = new Euler();
const poseQuaternion = new Quaternion();

function poseBone(entry: RigBone | undefined, x: number, y: number, z: number) {
  if (!entry) return;
  poseEuler.set(x, y, z, "XYZ");
  poseQuaternion.setFromEuler(poseEuler);
  entry.bone.quaternion.copy(entry.base).multiply(poseQuaternion);
}

function resetRig(rig: DanceRig, elapsed = 0) {
  poseBone(rig.hips, 0, 0, 0);
  poseBone(rig.spine, Math.sin(elapsed * 1.5) * 0.006, 0, 0);
  poseBone(rig.chest, Math.sin(elapsed * 1.5) * 0.012, 0, 0);
  poseBone(rig.neck, 0, 0, 0);
  poseBone(rig.head, 0, 0, 0);
  poseBone(rig.leftShoulder, 0, 0, 0);
  poseBone(rig.rightShoulder, 0, 0, 0);
  poseBone(rig.leftArm, 0, 0, 0);
  poseBone(rig.rightArm, 0, 0, 0);
  poseBone(rig.leftForeArm, 0, 0, 0);
  poseBone(rig.rightForeArm, 0, 0, 0);
  poseBone(rig.leftUpLeg, 0, 0, 0);
  poseBone(rig.rightUpLeg, 0, 0, 0);
  poseBone(rig.leftLeg, 0, 0, 0);
  poseBone(rig.rightLeg, 0, 0, 0);
}

function applyTPose(rig: DanceRig) {
  resetRig(rig);
  poseBone(rig.leftShoulder, 0, 0, 0.06);
  poseBone(rig.rightShoulder, 0, 0, -0.06);
  poseBone(rig.leftArm, 0, 0, Math.PI / 2 - 0.08);
  poseBone(rig.rightArm, 0, 0, -Math.PI / 2 + 0.08);
  poseBone(rig.leftForeArm, 0, 0, 0);
  poseBone(rig.rightForeArm, 0, 0, 0);
}

function applyWalk(rig: DanceRig, elapsed: number) {
  const beat = Math.sin(elapsed * 4.2);
  const halfBeat = Math.sin(elapsed * 2.1);
  const side = Math.sin(elapsed * 1.5);
  const safe = (value: number, min: number, max: number) => MathUtils.clamp(value, min, max);

  poseBone(rig.hips, 0, safe(side * 0.07, -0.08, 0.08), safe(halfBeat * 0.035, -0.04, 0.04));
  poseBone(rig.spine, safe(beat * 0.025, -0.03, 0.03), safe(-side * 0.04, -0.05, 0.05), safe(-halfBeat * 0.025, -0.03, 0.03));
  poseBone(rig.chest, safe(-beat * 0.035, -0.04, 0.04), safe(side * 0.055, -0.06, 0.06), safe(halfBeat * 0.035, -0.04, 0.04));
  poseBone(rig.leftShoulder, 0, 0, 0.08);
  poseBone(rig.rightShoulder, 0, 0, -0.08);
  poseBone(rig.leftArm, safe(-0.05 + beat * 0.08, -0.14, 0.04), 0, 0.16);
  poseBone(rig.rightArm, safe(-0.05 - beat * 0.08, -0.14, 0.04), 0, -0.16);
  poseBone(rig.leftForeArm, 0, 0, safe(0.1 + halfBeat * 0.05, 0.04, 0.16));
  poseBone(rig.rightForeArm, 0, 0, safe(-0.1 - halfBeat * 0.05, -0.16, -0.04));
  poseBone(rig.leftUpLeg, safe(halfBeat * 0.16, -0.18, 0.18), 0, 0);
  poseBone(rig.rightUpLeg, safe(-halfBeat * 0.16, -0.18, 0.18), 0, 0);
  poseBone(rig.leftLeg, safe(Math.max(0, -halfBeat) * 0.16, 0, 0.18), 0, 0);
  poseBone(rig.rightLeg, safe(Math.max(0, halfBeat) * 0.16, 0, 0.18), 0, 0);
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
  poseMode = "idle",
  onReady,
}: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const motionTestRef = useRef(motionTest);
  const poseModeRef = useRef<AvatarPoseMode>(poseMode);
  const [state, setState] = useState<ModelState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => { motionTestRef.current = motionTest; }, [motionTest]);
  useEffect(() => { poseModeRef.current = poseMode; }, [poseMode]);

  useEffect(() => {
    if (!mount.current) return;

    let disposed = false;
    let raf = 0;
    let currentModel: Object3D | null = null;
    let mixer: AnimationMixer | null = null;
    let rig: DanceRig = {};
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let baseY = 0;
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
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new DirectionalLight(0x8b5cf6, 2.1);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);

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
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      if (resumeTimer) clearTimeout(resumeTimer);
    });
    controls.addEventListener("end", () => {
      resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 2600);
    });

    const resize = () => {
      const rect = mount.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      if (currentModel) {
        const framed = frameAvatar(camera, currentModel, width / height, 1.28);
        controls.target.copy(framed.center);
        controls.minDistance = Math.max(framed.distance * 0.72, 1.1);
        controls.maxDistance = framed.distance * 1.75;
        controls.update();
      } else {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount.current);
    window.addEventListener("resize", resize);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const attachModel = (object: Object3D, animations: any[], isFallback: boolean) => {
      if (disposed) return;
      normalizeAvatarObject(object, { targetHeight: 2.05, frontRotationY });
      object.traverse((child: any) => {
        if (child.isMesh || child.isSkinnedMesh) {
          child.visible = true;
          child.frustumCulled = false;
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.isSkinnedMesh) child.normalizeSkinWeights?.();
        }
      });
      currentModel = object;
      baseY = object.position.y;
      rig = collectRig(object);
      scene.add(object);

      if (playAnimations && poseModeRef.current === "idle" && animations.length) {
        const idle = animations.find((clip) => String(clip.name).toLowerCase() === "idle")
          ?? animations.find((clip) => String(clip.name).toLowerCase().includes("idle"));
        if (idle) {
          mixer = new AnimationMixer(object);
          mixer.clipAction(idle).reset().play();
        }
      }

      setState(isFallback ? "fallback" : "ready");
      setErrorMessage(null);
      onReady?.(object);
      requestAnimationFrame(resize);
    };

    const loadUrl = async (url: string, isFallback: boolean) => {
      const gltf = await loader.loadAsync(url);
      attachModel(gltf.scene, gltf.animations, isFallback);
    };

    const useTechnicalFallback = () => {
      if (!config) { setState("error"); return; }
      attachModel(buildProceduralClouvaAvatar(config), [], true);
    };

    const load = async () => {
      setState("loading");
      setErrorMessage(null);
      try {
        if (modelData) {
          const gltf = await loader.parseAsync(modelData.slice(0), "");
          attachModel(gltf.scene, gltf.animations, false);
          return;
        }
        if (modelUrl) {
          await loadUrl(modelUrl, false);
          return;
        }
        if (fallbackModelUrl) {
          await loadUrl(fallbackModelUrl, true);
          return;
        }
        useTechnicalFallback();
      } catch (primaryError) {
        console.warn("Primary avatar failed", primaryError);
        if (fallbackModelUrl && fallbackModelUrl !== modelUrl) {
          try { await loadUrl(fallbackModelUrl, true); return; }
          catch (fallbackError) {
            setErrorMessage(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
          }
        } else {
          setErrorMessage(primaryError instanceof Error ? primaryError.message : String(primaryError));
        }
        useTechnicalFallback();
      }
    };
    void load();

    const animate = () => {
      if (!document.hidden) {
        const delta = clock.getDelta();
        const elapsed = clock.elapsedTime;
        const mode = poseModeRef.current;

        if (mode === "idle") mixer?.update(delta);
        else if (mixer) { mixer.stopAllAction(); mixer = null; }

        if (currentModel && !mixer) {
          if (mode === "tpose") applyTPose(rig);
          else if (mode === "walk" || motionTestRef.current) applyWalk(rig, elapsed);
          else resetRig(rig, elapsed);

          const breath = mode === "idle" ? Math.sin(elapsed * 1.5) : 0;
          currentModel.position.y = baseY + breath * 0.0025 + (mode === "walk" ? Math.abs(Math.sin(elapsed * 4.2)) * 0.006 : 0);
          currentModel.scale.y = 1 + breath * 0.002;
          currentModel.scale.x = 1 - breath * 0.001;
          currentModel.scale.z = 1 - breath * 0.001;
        }

        controls.update();
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (resumeTimer) clearTimeout(resumeTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      mixer?.stopAllAction();
      controls.dispose();
      renderer.dispose();
      mount.current?.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, modelData, frontRotationY, playAnimations, config, onReady]);

  return (
    <div
      className={`avatar-render-shell ${className}`}
      data-state={state}
      data-avatar-source={state === "ready" ? "glb" : "fallback"}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
      aria-label={alt}
    >
      {state === "loading" ? <div className="avatar-loader">Cargando CLOUVA…</div> : null}
      {state === "error" ? <div className="avatar-loader" style={{ maxWidth: "88vw", textAlign: "center", zIndex: 30 }}>Error de avatar: {errorMessage}</div> : null}
      <div ref={mount} className="avatar-model-viewer" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh", touchAction: "none" }} />
    </div>
  );
}
