"use client";

import { useEffect, useRef } from "react";
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
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SkinnedMesh,
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
  leftUpperLeg?: Bone;
  rightUpperLeg?: Bone;
  base: Map<Bone, Quaternion>;
};

type Segment = { bone: Bone; child: Bone; midpoint: Vector3; direction: Vector3 };

const LEFT = new Vector3(-1, 0, 0);
const RIGHT = new Vector3(1, 0, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpCurrent = new Vector3();
const tmpDesired = new Vector3();
const tmpParentQ = new Quaternion();
const tmpRootQ = new Quaternion();
const tmpDelta = new Quaternion();

function clean(name: string) {
  return name.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function uniqueBones(root: Object3D) {
  const result = new Set<Bone>();
  root.traverse((object: any) => {
    if (object.isBone) result.add(object as Bone);
    if (object.isSkinnedMesh) {
      for (const bone of (object as SkinnedMesh).skeleton?.bones ?? []) result.add(bone);
    }
  });
  return [...result];
}

function findByName(bones: Bone[], names: string[]) {
  return bones.find((bone) => names.includes(clean(bone.name)))
    ?? bones.find((bone) => names.some((name) => clean(bone.name).includes(name)));
}

async function resolveVrmBones(gltf: GLTF) {
  const map = new Map<string, Bone>();
  const parser: any = gltf.parser;
  const jsonExtensions = parser?.json?.extensions ?? {};
  const userExtensions = gltf.userData?.gltfExtensions ?? {};
  const extensions = { ...jsonExtensions, ...userExtensions };
  const vrm1 = extensions.VRMC_vrm?.humanoid?.humanBones;
  if (vrm1 && parser) {
    for (const [name, entry] of Object.entries(vrm1) as Array<[string, { node?: number }]>) {
      if (typeof entry?.node !== "number") continue;
      const node = await parser.getDependency("node", entry.node);
      if ((node as Bone)?.isBone) map.set(name, node as Bone);
    }
  }
  const vrm0 = extensions.VRM?.humanoid?.humanBones;
  if (Array.isArray(vrm0) && parser) {
    for (const entry of vrm0) {
      if (typeof entry?.node !== "number" || !entry?.bone) continue;
      const node = await parser.getDependency("node", entry.node);
      if ((node as Bone)?.isBone) map.set(entry.bone, node as Bone);
    }
  }
  return map;
}

function firstBoneChild(bone: Bone | undefined) {
  return bone?.children.find((child: any) => child.isBone) as Bone | undefined;
}

function geometricFallback(root: Object3D, bones: Bone[]) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  const centerX = (box.min.x + box.max.x) * 0.5;
  const segments: Segment[] = [];

  for (const bone of bones) {
    for (const child of bone.children.filter((item: any) => item.isBone) as Bone[]) {
      const start = bone.getWorldPosition(new Vector3());
      const end = child.getWorldPosition(new Vector3());
      const vector = end.clone().sub(start);
      if (vector.length() < 0.0001) continue;
      segments.push({ bone, child, midpoint: start.clone().add(end).multiplyScalar(0.5), direction: vector.normalize() });
    }
  }

  const relativeY = (point: Vector3) => (point.y - box.min.y) / height;
  const relativeX = (point: Vector3) => (point.x - centerX) / height;

  function upperArm(side: -1 | 1) {
    const candidates = segments
      .filter((segment) => {
        const y = relativeY(segment.midpoint);
        const x = relativeX(segment.midpoint) * side;
        const horizontal = Math.abs(segment.direction.x) > Math.abs(segment.direction.y) * 0.3;
        return y > 0.48 && y < 0.82 && x > 0.035 && horizontal;
      })
      .sort((a, b) => Math.abs(relativeY(b.midpoint) - 0.67) - Math.abs(relativeY(a.midpoint) - 0.67));
    return candidates[0]?.bone;
  }

  function upperLeg(side: -1 | 1) {
    const candidates = segments
      .filter((segment) => {
        const y = relativeY(segment.midpoint);
        const x = relativeX(segment.midpoint) * side;
        const vertical = Math.abs(segment.direction.y) > Math.abs(segment.direction.x) * 0.55;
        return y > 0.2 && y < 0.58 && x > 0.008 && vertical;
      })
      .sort((a, b) => b.midpoint.y - a.midpoint.y);
    return candidates[0]?.bone;
  }

  return {
    leftUpperArm: upperArm(-1),
    rightUpperArm: upperArm(1),
    leftUpperLeg: upperLeg(-1),
    rightUpperLeg: upperLeg(1),
  };
}

async function collectRig(gltf: GLTF, root: Object3D): Promise<HumanRig> {
  const bones = uniqueBones(root);
  const vrm = await resolveVrmBones(gltf);
  const pick = (vrmName: string, aliases: string[]) => vrm.get(vrmName) ?? findByName(bones, aliases);
  const geo = geometricFallback(root, bones);
  const rig: HumanRig = {
    leftUpperArm: pick("leftUpperArm", ["leftupperarm", "upperarml", "jbiplupperarm", "lupperarm"]) ?? geo.leftUpperArm,
    rightUpperArm: pick("rightUpperArm", ["rightupperarm", "upperarmr", "jbiprupperarm", "rupperarm"]) ?? geo.rightUpperArm,
    leftUpperLeg: pick("leftUpperLeg", ["leftupperleg", "leftupleg", "thighl", "jbiplupperleg", "upperlegl"]) ?? geo.leftUpperLeg,
    rightUpperLeg: pick("rightUpperLeg", ["rightupperleg", "rightupleg", "thighr", "jbiprupperleg", "upperlegr"]) ?? geo.rightUpperLeg,
    base: new Map(),
  };
  for (const bone of bones) rig.base.set(bone, bone.quaternion.clone());
  console.info("[Creator Studio stable rig]", {
    bones: bones.length,
    leftUpperArm: rig.leftUpperArm?.name,
    rightUpperArm: rig.rightUpperArm?.name,
    leftUpperLeg: rig.leftUpperLeg?.name,
    rightUpperLeg: rig.rightUpperLeg?.name,
  });
  return rig;
}

function resetRig(rig: HumanRig) {
  for (const [bone, base] of rig.base) bone.quaternion.copy(base);
}

function aimBone(root: Object3D, bone: Bone | undefined, targetLocal: Vector3) {
  if (!bone) return;
  const child = firstBoneChild(bone);
  if (!child) return;
  bone.getWorldPosition(tmpA);
  child.getWorldPosition(tmpB);
  tmpCurrent.copy(tmpB).sub(tmpA).normalize();
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

function applyStableProceduralPose(root: Object3D, rig: HumanRig, mode: CreatorPoseMode, elapsed: number) {
  resetRig(rig);
  root.updateMatrixWorld(true);

  if (mode === "tpose") {
    // Sólo se orienta el brazo superior. El antebrazo, la mano y los dedos heredan
    // la transformación y conservan la orientación original del rig.
    aimBone(root, rig.leftUpperArm, LEFT);
    aimBone(root, rig.rightUpperArm, RIGHT);
    return;
  }

  if (mode === "walk") {
    const step = Math.sin(elapsed * 4.2);
    aimBone(root, rig.leftUpperArm, new Vector3(-0.14, -0.97, step * 0.22).normalize());
    aimBone(root, rig.rightUpperArm, new Vector3(0.14, -0.97, -step * 0.22).normalize());
    aimBone(root, rig.leftUpperLeg, new Vector3(-0.04, -0.98, -step * 0.2).normalize());
    aimBone(root, rig.rightUpperLeg, new Vector3(0.04, -0.98, step * 0.2).normalize());
    return;
  }

  const sway = Math.sin(elapsed * 1.4) * 0.018;
  aimBone(root, rig.leftUpperArm, new Vector3(-0.12, -0.99, sway).normalize());
  aimBone(root, rig.rightUpperArm, new Vector3(0.12, -0.99, -sway).normalize());
}

function findClip(clips: AnimationClip[], mode: CreatorPoseMode) {
  const words = mode === "walk" ? ["walk", "walking"] : ["idle", "stand", "breath"];
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
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 768 ? 1 : 1.5));
    mount.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x160b25, 1.65));
    scene.add(new AmbientLight(0xffffff, 0.55));
    const light = new DirectionalLight(0xffffff, 2.25);
    light.position.set(3, 5, 4);
    scene.add(light);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 8;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
      camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      if (model) {
        const framed = frameAvatar(camera, model, camera.aspect, 1.28);
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
      } catch (error) {
        console.warn("Creator Studio avatar failed", error);
        const fallback = buildProceduralClouvaAvatar(config);
        await attach({ scene: fallback, scenes: [fallback], animations: [], cameras: [], asset: {}, parser: undefined as never, userData: {} });
      }
    })();

    const clock = new Clock();
    const animate = () => {
      const delta = Math.min(clock.getDelta(), 1 / 20);
      const elapsed = clock.elapsedTime;
      const mode = poseRef.current;

      if (mode !== activeMode) {
        action?.stop();
        action = null;
        if (mode !== "tpose" && mixer) {
          const clip = findClip(clips, mode);
          if (clip) {
            action = mixer.clipAction(clip);
            action.reset().fadeIn(0.16).play();
          }
        }
        activeMode = mode;
      }

      if (action && mixer) mixer.update(delta);
      else if (model && rig) applyStableProceduralPose(model, rig, mode, elapsed);
      if (model) model.position.y = baseY + (mode === "walk" ? Math.abs(Math.sin(elapsed * 4.2)) * 0.004 : 0);
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
