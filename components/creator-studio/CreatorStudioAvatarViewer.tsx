"use client";

import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  Clock,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { frameAvatar, normalizeAvatarObject } from "@/lib/avatar-engine/frame-avatar";
import { buildProceduralClouvaAvatar } from "@/lib/avatar-engine/procedural-clouva";
import type { AvatarConfig } from "@/lib/avatar-engine/types";

export type CreatorPoseMode = "idle" | "tpose" | "walk";

type Props = {
  modelUrl: string | null;
  fallbackModelUrl?: string | null;
  frontRotationY?: number;
  config: AvatarConfig;
  poseMode: CreatorPoseMode;
  className?: string;
  onReady?: (object: Object3D) => void;
};

type HumanRig = {
  leftUpperArm?: Bone;
  rightUpperArm?: Bone;
  leftLowerArm?: Bone;
  rightLowerArm?: Bone;
  leftUpperLeg?: Bone;
  rightUpperLeg?: Bone;
  leftLowerLeg?: Bone;
  rightLowerLeg?: Bone;
  base: Map<Bone, Quaternion>;
};

const left = new Vector3(-1, 0, 0);
const right = new Vector3(1, 0, 0);
const down = new Vector3(0, -1, 0);
const tmpStart = new Vector3();
const tmpEnd = new Vector3();
const tmpCurrent = new Vector3();
const tmpDesired = new Vector3();
const tmpParentQ = new Quaternion();
const tmpRootQ = new Quaternion();
const tmpDelta = new Quaternion();

function clean(name: string) {
  return name.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function findByName(bones: Bone[], names: string[]) {
  return bones.find((bone) => names.includes(clean(bone.name)))
    ?? bones.find((bone) => names.some((name) => clean(bone.name).includes(name)));
}

async function resolveVrmBones(gltf: GLTF) {
  const ext = gltf.userData?.gltfExtensions ?? {};
  const map = new Map<string, Bone>();
  const parser = gltf.parser;

  const vrm1 = ext.VRMC_vrm?.humanoid?.humanBones;
  if (vrm1 && parser) {
    for (const [name, entry] of Object.entries(vrm1) as Array<[string, { node?: number }]>) {
      if (typeof entry?.node !== "number") continue;
      const node = await parser.getDependency("node", entry.node);
      if ((node as Bone)?.isBone) map.set(name, node as Bone);
    }
  }

  const vrm0 = ext.VRM?.humanoid?.humanBones;
  if (Array.isArray(vrm0) && parser) {
    for (const entry of vrm0) {
      if (typeof entry?.node !== "number" || !entry?.bone) continue;
      const node = await parser.getDependency("node", entry.node);
      if ((node as Bone)?.isBone) map.set(entry.bone, node as Bone);
    }
  }

  return map;
}

async function collectRig(gltf: GLTF, root: Object3D): Promise<HumanRig> {
  const bones: Bone[] = [];
  root.traverse((object) => {
    if ((object as Bone).isBone) bones.push(object as Bone);
  });
  const vrm = await resolveVrmBones(gltf);
  const pick = (vrmName: string, aliases: string[]) => vrm.get(vrmName) ?? findByName(bones, aliases);
  const rig: HumanRig = {
    leftUpperArm: pick("leftUpperArm", ["leftupperarm", "upperarml", "jbiplupperarm"]),
    rightUpperArm: pick("rightUpperArm", ["rightupperarm", "upperarmr", "jbiprupperarm"]),
    leftLowerArm: pick("leftLowerArm", ["leftlowerarm", "leftforearm", "lowerarml", "jbipllowerarm"]),
    rightLowerArm: pick("rightLowerArm", ["rightlowerarm", "rightforearm", "lowerarmr", "jbiprlowerarm"]),
    leftUpperLeg: pick("leftUpperLeg", ["leftupperleg", "leftupleg", "thighl", "jbiplupperleg"]),
    rightUpperLeg: pick("rightUpperLeg", ["rightupperleg", "rightupleg", "thighr", "jbiprupperleg"]),
    leftLowerLeg: pick("leftLowerLeg", ["leftlowerleg", "leftleg", "calfl", "jbipllowerleg"]),
    rightLowerLeg: pick("rightLowerLeg", ["rightlowerleg", "rightleg", "calfr", "jbiprlowerleg"]),
    base: new Map(),
  };
  for (const bone of bones) rig.base.set(bone, bone.quaternion.clone());
  return rig;
}

function resetRig(rig: HumanRig) {
  for (const [bone, base] of rig.base) bone.quaternion.copy(base);
}

function aimBone(root: Object3D, bone: Bone | undefined, targetLocal: Vector3) {
  if (!bone) return;
  const child = bone.children.find((item) => (item as Bone).isBone) as Bone | undefined;
  if (!child) return;

  bone.getWorldPosition(tmpStart);
  child.getWorldPosition(tmpEnd);
  tmpCurrent.copy(tmpEnd).sub(tmpStart).normalize();

  root.getWorldQuaternion(tmpRootQ);
  tmpDesired.copy(targetLocal).applyQuaternion(tmpRootQ).normalize();

  bone.parent?.getWorldQuaternion(tmpParentQ);
  tmpParentQ.invert();
  tmpCurrent.applyQuaternion(tmpParentQ).normalize();
  tmpDesired.applyQuaternion(tmpParentQ).normalize();

  tmpDelta.setFromUnitVectors(tmpCurrent, tmpDesired);
  bone.quaternion.premultiply(tmpDelta);
  bone.updateWorldMatrix(true, true);
}

function applyProceduralPose(root: Object3D, rig: HumanRig, mode: CreatorPoseMode, elapsed: number) {
  resetRig(rig);
  if (mode === "tpose") {
    aimBone(root, rig.leftUpperArm, left);
    aimBone(root, rig.leftLowerArm, left);
    aimBone(root, rig.rightUpperArm, right);
    aimBone(root, rig.rightLowerArm, right);
    return;
  }

  if (mode === "walk") {
    const step = Math.sin(elapsed * 4.2);
    aimBone(root, rig.leftUpperArm, new Vector3(-0.16, -0.96, step * 0.28).normalize());
    aimBone(root, rig.rightUpperArm, new Vector3(0.16, -0.96, -step * 0.28).normalize());
    aimBone(root, rig.leftLowerArm, new Vector3(-0.1, -0.99, step * 0.1).normalize());
    aimBone(root, rig.rightLowerArm, new Vector3(0.1, -0.99, -step * 0.1).normalize());
    aimBone(root, rig.leftUpperLeg, new Vector3(-0.05, -0.98, -step * 0.24).normalize());
    aimBone(root, rig.rightUpperLeg, new Vector3(0.05, -0.98, step * 0.24).normalize());
    aimBone(root, rig.leftLowerLeg, down);
    aimBone(root, rig.rightLowerLeg, down);
    return;
  }

  const sway = Math.sin(elapsed * 1.4) * 0.02;
  aimBone(root, rig.leftUpperArm, new Vector3(-0.14, -0.99, sway).normalize());
  aimBone(root, rig.rightUpperArm, new Vector3(0.14, -0.99, -sway).normalize());
}

function findClip(clips: AnimationClip[], mode: CreatorPoseMode) {
  const words = mode === "walk" ? ["walk", "walking", "jog", "run"] : ["idle", "stand", "breath"];
  return clips.find((clip) => words.some((word) => clean(clip.name).includes(word))) ?? null;
}

export function CreatorStudioAvatarViewer({ modelUrl, fallbackModelUrl, frontRotationY = 0, config, poseMode, className = "", onReady }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef(poseMode);
  const readyRef = useRef(onReady);

  useEffect(() => { poseRef.current = poseMode; }, [poseMode]);
  useEffect(() => { readyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let frame = 0;
    let model: Object3D | null = null;
    let rig: HumanRig | null = null;
    let clips: AnimationClip[] = [];
    let mixer: AnimationMixer | null = null;
    let action: AnimationAction | null = null;
    let activeMode: CreatorPoseMode | null = null;
    let baseY = 0;

    const scene = new Scene();
    const camera = new PerspectiveCamera(31, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 768 ? 1 : 1.5));
    mount.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x160b25, 2.2));
    scene.add(new AmbientLight(0xffffff, 0.9));
    const light = new DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
      if (model) {
        const framed = frameAvatar(camera, model, Math.max(rect.width, 1) / Math.max(rect.height, 1), 1.28);
        controls.target.copy(framed.center);
        controls.update();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const attach = async (gltf: GLTF) => {
      if (disposed) return;
      normalizeAvatarObject(gltf.scene, { targetHeight: 2.05, frontRotationY });
      gltf.scene.traverse((child: any) => {
        if (child.isMesh || child.isSkinnedMesh) {
          child.visible = true;
          child.frustumCulled = false;
          child.normalizeSkinWeights?.();
        }
      });
      model = gltf.scene;
      baseY = model.position.y;
      clips = gltf.animations;
      rig = await collectRig(gltf, model);
      mixer = clips.length ? new AnimationMixer(model) : null;
      scene.add(model);
      readyRef.current?.(model);
      resize();
    };

    void (async () => {
      try {
        if (modelUrl) await attach(await loader.loadAsync(modelUrl));
        else if (fallbackModelUrl) await attach(await loader.loadAsync(fallbackModelUrl));
        else {
          const fallback = buildProceduralClouvaAvatar(config);
          await attach({ scene: fallback, scenes: [fallback], animations: [], cameras: [], asset: {}, parser: undefined as never, userData: {} });
        }
      } catch {
        const fallback = buildProceduralClouvaAvatar(config);
        await attach({ scene: fallback, scenes: [fallback], animations: [], cameras: [], asset: {}, parser: undefined as never, userData: {} });
      }
    })();

    const clock = new Clock();
    const animate = () => {
      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;
      const mode = poseRef.current;
      if (mode !== activeMode) {
        action?.stop();
        action = null;
        if (mode !== "tpose" && mixer) {
          const clip = findClip(clips, mode);
          if (clip) {
            action = mixer.clipAction(clip);
            action.reset().play();
          }
        }
        activeMode = mode;
      }
      if (action && mixer) mixer.update(delta);
      else if (model && rig) applyProceduralPose(model, rig, mode, elapsed);
      if (model) model.position.y = baseY + (mode === "walk" ? Math.abs(Math.sin(elapsed * 4.2)) * 0.006 : 0);
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      action?.stop();
      mixer?.stopAllAction();
      controls.dispose();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, frontRotationY, config]);

  return <div ref={mountRef} className={className} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: 500 }} />;
}
