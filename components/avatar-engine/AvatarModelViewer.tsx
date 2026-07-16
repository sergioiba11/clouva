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

type RigKey =
  | "hips" | "spine" | "chest" | "neck" | "head"
  | "leftShoulder" | "rightShoulder" | "leftArm" | "rightArm"
  | "leftForeArm" | "rightForeArm" | "leftUpLeg" | "rightUpLeg"
  | "leftLeg" | "rightLeg";

type RigBone = { bone: Bone; base: Quaternion };
type Rig = Partial<Record<RigKey, RigBone>>;

const ALIASES: Record<RigKey, readonly string[]> = {
  hips: ["hips", "pelvis", "jbiphips", "jbipc hips".replace(" ", "")],
  spine: ["spine", "spine01", "spine1", "jbipspine"],
  chest: ["spine02", "spine2", "chest", "upperchest", "jbipchest", "jbipupperchest"],
  neck: ["neck", "jbipneck"],
  head: ["head", "jbiphead"],
  leftShoulder: ["leftshoulder", "shoulderl", "claviclel", "leftclavicle", "jbiplshoulder"],
  rightShoulder: ["rightshoulder", "shoulderr", "clavicler", "rightclavicle", "jbiprshoulder"],
  leftArm: ["leftarm", "upperarml", "upperarmleft", "jbiplupperarm"],
  rightArm: ["rightarm", "upperarmr", "upperarmright", "jbiprupperarm"],
  leftForeArm: ["leftforearm", "forearml", "lowerarml", "jbipllowerarm"],
  rightForeArm: ["rightforearm", "forearmr", "lowerarmr", "jbiprlowerarm"],
  leftUpLeg: ["leftupleg", "thighl", "upperlegl", "jbiplupperleg"],
  rightUpLeg: ["rightupleg", "thighr", "upperlegr", "jbiprupperleg"],
  leftLeg: ["leftleg", "calfl", "lowerlegl", "shinl", "jbipllowerleg"],
  rightLeg: ["rightleg", "calfr", "lowerlegr", "shinr", "jbiprlowerleg"],
};

function cleanName(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function collectRig(root: Object3D): Rig {
  const bones: Bone[] = [];
  root.traverse((object) => {
    const bone = object as Bone;
    if (bone.isBone) bones.push(bone);
  });

  const rig: Rig = {};
  for (const key of Object.keys(ALIASES) as RigKey[]) {
    const aliases = ALIASES[key];
    const bone = bones.find((candidate) => aliases.includes(cleanName(candidate.name)))
      ?? bones.find((candidate) => aliases.some((alias) => cleanName(candidate.name).includes(alias) || alias.includes(cleanName(candidate.name))));
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

function applyIdle(rig: Rig, elapsed: number) {
  const breath = Math.sin(elapsed * 1.5);
  poseBone(rig.hips, 0, 0, 0);
  poseBone(rig.spine, breath * 0.008, 0, 0);
  poseBone(rig.chest, breath * 0.014, 0, 0);
  poseBone(rig.neck, 0, 0, 0);
  poseBone(rig.head, breath * 0.008, 0, 0);
  poseBone(rig.leftShoulder, 0, 0, 0.045);
  poseBone(rig.rightShoulder, 0, 0, -0.045);
  poseBone(rig.leftArm, -0.025, 0, 0.11);
  poseBone(rig.rightArm, -0.025, 0, -0.11);
  poseBone(rig.leftForeArm, 0, 0, 0.035);
  poseBone(rig.rightForeArm, 0, 0, -0.035);
  poseBone(rig.leftUpLeg, 0, 0, 0);
  poseBone(rig.rightUpLeg, 0, 0, 0);
  poseBone(rig.leftLeg, 0, 0, 0);
  poseBone(rig.rightLeg, 0, 0, 0);
}

function applyTPose(rig: Rig) {
  applyIdle(rig, 0);
  poseBone(rig.leftShoulder, 0, 0, 0.06);
  poseBone(rig.rightShoulder, 0, 0, -0.06);
  poseBone(rig.leftArm, 0, 0, Math.PI / 2 - 0.08);
  poseBone(rig.rightArm, 0, 0, -Math.PI / 2 + 0.08);
  poseBone(rig.leftForeArm, 0, 0, 0);
  poseBone(rig.rightForeArm, 0, 0, 0);
}

function applyWalk(rig: Rig, elapsed: number) {
  const step = Math.sin(elapsed * 4.2);
  const halfStep = Math.sin(elapsed * 2.1);
  const safe = (value: number, min: number, max: number) => MathUtils.clamp(value, min, max);

  poseBone(rig.hips, 0, safe(step * 0.035, -0.04, 0.04), 0);
  poseBone(rig.spine, safe(-halfStep * 0.025, -0.03, 0.03), 0, 0);
  poseBone(rig.chest, safe(halfStep * 0.03, -0.035, 0.035), 0, 0);
  poseBone(rig.leftShoulder, 0, 0, 0.08);
  poseBone(rig.rightShoulder, 0, 0, -0.08);
  poseBone(rig.leftArm, safe(-step * 0.24, -0.26, 0.26), 0, 0.14);
  poseBone(rig.rightArm, safe(step * 0.24, -0.26, 0.26), 0, -0.14);
  poseBone(rig.leftForeArm, 0, 0, 0.08);
  poseBone(rig.rightForeArm, 0, 0, -0.08);
  poseBone(rig.leftUpLeg, safe(step * 0.25, -0.28, 0.28), 0, 0);
  poseBone(rig.rightUpLeg, safe(-step * 0.25, -0.28, 0.28), 0, 0);
  poseBone(rig.leftLeg, safe(Math.max(0, -step) * 0.2, 0, 0.22), 0, 0);
  poseBone(rig.rightLeg, safe(Math.max(0, step) * 0.2, 0, 0.22), 0, 0);
}

export function AvatarModelViewer({
  modelUrl,
  fallbackModelUrl = null,
  modelData,
  frontRotationY = 0,
  config,
  alt,
  className = "",
  playAnimations = true,
  motionTest = false,
  poseMode = "idle",
  onReady,
}: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const poseModeRef = useRef<AvatarPoseMode>(poseMode);
  const motionTestRef = useRef(motionTest);
  const onReadyRef = useRef(onReady);
  const [state, setState] = useState<ModelState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => { poseModeRef.current = poseMode; }, [poseMode]);
  useEffect(() => { motionTestRef.current = motionTest; }, [motionTest]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    if (!mount.current) return;

    let disposed = false;
    let raf = 0;
    let currentModel: Object3D | null = null;
    let rig: Rig = {};
    let baseY = 0;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const mixerBox: { current: AnimationMixer | null } = { current: null };
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
          mixerBox.current = new AnimationMixer(object);
          mixerBox.current.clipAction(idle).reset().play();
        }
      }

      setState(isFallback ? "fallback" : "ready");
      setErrorMessage(null);
      onReadyRef.current?.(object);
      requestAnimationFrame(resize);
    };

    const loadUrl = async (url: string, isFallback: boolean) => {
      const gltf = await loader.loadAsync(url);
      attachModel(gltf.scene, gltf.animations, isFallback);
    };

    const useTechnicalFallback = () => {
      if (!config) {
        setState("error");
        return;
      }
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
          try {
            await loadUrl(fallbackModelUrl, true);
            return;
          } catch (fallbackError) {
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
        const mixer = mixerBox.current;

        if (mode === "idle" && mixer) {
          mixer.update(delta);
        } else {
          if (mixer) {
            mixer.stopAllAction();
            mixerBox.current = null;
          }
          if (currentModel) {
            if (mode === "tpose") applyTPose(rig);
            else if (mode === "walk" || motionTestRef.current) applyWalk(rig, elapsed);
            else applyIdle(rig, elapsed);
          }
        }

        if (currentModel) {
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
      mixerBox.current?.stopAllAction();
      controls.dispose();
      renderer.dispose();
      mount.current?.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, modelData, frontRotationY, playAnimations, config]);

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
