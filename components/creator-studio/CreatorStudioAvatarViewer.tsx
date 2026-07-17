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

export type AnchorBoneKey = "head" | "neck" | "chest" | "upperChest" | "spine" | "leftHand" | "rightHand";

export type CreatorStudioAvatarContext = {
  model: Object3D;
  headBone: Bone | null;
  bones: Record<AnchorBoneKey, Bone | null>;
  refit: () => void;
};

type Props = {
  modelUrl: string | null;
  fallbackModelUrl?: string | null;
  frontRotationY?: number;
  viewRotationY?: number;
  config: AvatarConfig;
  poseMode: CreatorPoseMode;
  className?: string;
  onReady?: (object: Object3D, context?: CreatorStudioAvatarContext) => void;
};

type BoneBase = { quaternion: Quaternion; position: Vector3 };

type HumanRig = {
  head?: Bone;
  neck?: Bone;
  chest?: Bone;
  upperChest?: Bone;
  spine?: Bone;
  leftHand?: Bone;
  rightHand?: Bone;
  leftUpperArm?: Bone;
  rightUpperArm?: Bone;
  leftUpperLeg?: Bone;
  rightUpperLeg?: Bone;
  base: Map<Bone, BoneBase>;
  armsReady: boolean;
  walkReady: boolean;
};

type Segment = {
  bone: Bone;
  child: Bone;
  start: Vector3;
  end: Vector3;
  midpoint: Vector3;
  direction: Vector3;
  length: number;
};

const LEFT = new Vector3(-1, 0, 0);
const RIGHT = new Vector3(1, 0, 0);
const WALK_LEFT_ARM = new Vector3();
const WALK_RIGHT_ARM = new Vector3();
const WALK_LEFT_LEG = new Vector3();
const WALK_RIGHT_LEG = new Vector3();
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

function highestCentralBone(root: Object3D, bones: Bone[]) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const centerX = (box.min.x + box.max.x) * 0.5;
  const height = Math.max(box.max.y - box.min.y, 0.001);

  return bones
    .map((bone) => ({ bone, point: bone.getWorldPosition(new Vector3()) }))
    .filter(({ bone, point }) => {
      const name = clean(bone.name);
      const central = Math.abs(point.x - centerX) < height * 0.18;
      const excluded = ["eye", "jaw", "mouth", "finger", "hand", "weapon"].some((token) => name.includes(token));
      return central && !excluded;
    })
    .sort((a, b) => b.point.y - a.point.y)[0]?.bone;
}

function geometricFallback(root: Object3D, bones: Bone[]) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  const centerX = (box.min.x + box.max.x) * 0.5;
  const segments: Segment[] = [];

  for (const bone of bones) {
    const boneName = clean(bone.name);
    if (["finger", "thumb", "hand", "eye", "jaw", "mouth", "toe"].some((token) => boneName.includes(token))) continue;

    for (const child of bone.children.filter((item: any) => item.isBone) as Bone[]) {
      const start = bone.getWorldPosition(new Vector3());
      const end = child.getWorldPosition(new Vector3());
      const vector = end.clone().sub(start);
      const length = vector.length();
      if (length < height * 0.025) continue;
      segments.push({
        bone,
        child,
        start,
        end,
        midpoint: start.clone().add(end).multiplyScalar(0.5),
        direction: vector.normalize(),
        length,
      });
    }
  }

  const relativeY = (point: Vector3) => (point.y - box.min.y) / height;
  const relativeX = (point: Vector3) => (point.x - centerX) / height;

  function upperArm(side: -1 | 1) {
    return segments
      .filter((segment) => {
        const y = relativeY(segment.start);
        const sideX = relativeX(segment.start) * side;
        const outward = (segment.end.x - segment.start.x) * side > -height * 0.025;
        return y > 0.50 && y < 0.80 && sideX > 0.025 && outward && segment.length < height * 0.30;
      })
      .sort((a, b) => {
        const scoreA = Math.abs(relativeY(a.start) - 0.67) + Math.abs(a.length / height - 0.13);
        const scoreB = Math.abs(relativeY(b.start) - 0.67) + Math.abs(b.length / height - 0.13);
        return scoreA - scoreB;
      })[0]?.bone;
  }

  function upperLeg(side: -1 | 1) {
    return segments
      .filter((segment) => {
        const y = relativeY(segment.start);
        const sideX = relativeX(segment.start) * side;
        const downward = segment.end.y < segment.start.y;
        return y > 0.34 && y < 0.61 && sideX > -0.025 && downward && segment.length < height * 0.34;
      })
      .sort((a, b) => {
        const scoreA = Math.abs(relativeY(a.start) - 0.48) + Math.abs(a.length / height - 0.18);
        const scoreB = Math.abs(relativeY(b.start) - 0.48) + Math.abs(b.length / height - 0.18);
        return scoreA - scoreB;
      })[0]?.bone;
  }

  return {
    head: highestCentralBone(root, bones),
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

  const leftUpperArm = pick("leftUpperArm", ["leftupperarm", "upperarml", "jbiplupperarm", "lupperarm"]) ?? geo.leftUpperArm;
  const rightUpperArm = pick("rightUpperArm", ["rightupperarm", "upperarmr", "jbiprupperarm", "rupperarm"]) ?? geo.rightUpperArm;
  const leftUpperLeg = pick("leftUpperLeg", ["leftupperleg", "leftupleg", "thighl", "jbiplupperleg", "upperlegl"]) ?? geo.leftUpperLeg;
  const rightUpperLeg = pick("rightUpperLeg", ["rightupperleg", "rightupleg", "thighr", "jbiprupperleg", "upperlegr"]) ?? geo.rightUpperLeg;

  const rig: HumanRig = {
    head: pick("head", ["head", "jbipchead", "bip01head"]) ?? geo.head,
    neck: pick("neck", ["neck", "neck1", "jbipcneck"]),
    chest: pick("chest", ["chest", "defchest", "mixamorigspine2"]),
    upperChest: pick("upperChest", ["upperchest", "defupperchest", "mixamorigspine2"]),
    spine: pick("spine", ["spine1", "spine", "defspine", "mixamorigspine1", "mixamorigspine"]),
    leftHand: pick("leftHand", ["lefthand", "handl", "defhandl", "jbiplhand"]),
    rightHand: pick("rightHand", ["righthand", "handr", "defhandr", "jbiprhand"]),
    leftUpperArm,
    rightUpperArm,
    leftUpperLeg,
    rightUpperLeg,
    base: new Map(),
    armsReady: Boolean(leftUpperArm && rightUpperArm),
    walkReady: Boolean(leftUpperArm && rightUpperArm && leftUpperLeg && rightUpperLeg),
  };

  for (const bone of bones) {
    rig.base.set(bone, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
  }

  console.info("[Creator Studio stable rig v3]", {
    bones: bones.length,
    head: rig.head?.name,
    neck: rig.neck?.name,
    chest: rig.chest?.name,
    upperChest: rig.upperChest?.name,
    spine: rig.spine?.name,
    leftHand: rig.leftHand?.name,
    rightHand: rig.rightHand?.name,
    leftUpperArm: rig.leftUpperArm?.name,
    rightUpperArm: rig.rightUpperArm?.name,
    leftUpperLeg: rig.leftUpperLeg?.name,
    rightUpperLeg: rig.rightUpperLeg?.name,
    clips: gltf.animations.map((clip) => clip.name),
  });

  return rig;
}

function resetRig(rig: HumanRig) {
  for (const [bone, base] of rig.base) {
    bone.quaternion.copy(base.quaternion);
    bone.position.copy(base.position);
  }
}

function aimBone(root: Object3D, bone: Bone | undefined, targetLocal: Vector3) {
  if (!bone) return;
  const child = firstBoneChild(bone);
  if (!child) return;

  root.updateMatrixWorld(true);
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

function applySafeProceduralPose(root: Object3D, rig: HumanRig, mode: CreatorPoseMode, elapsed: number) {
  resetRig(rig);
  root.updateMatrixWorld(true);

  if (mode === "tpose") {
    if (!rig.armsReady) return;
    // Solo los brazos superiores: antebrazos, manos y dedos conservan el bind pose.
    aimBone(root, rig.leftUpperArm, LEFT);
    aimBone(root, rig.rightUpperArm, RIGHT);
    return;
  }

  if (mode === "walk") {
    if (!rig.walkReady) return;
    const step = Math.sin(elapsed * 3.4);
    WALK_LEFT_ARM.set(-0.11, -0.99, step * 0.08).normalize();
    WALK_RIGHT_ARM.set(0.11, -0.99, -step * 0.08).normalize();
    WALK_LEFT_LEG.set(-0.025, -0.997, -step * 0.07).normalize();
    WALK_RIGHT_LEG.set(0.025, -0.997, step * 0.07).normalize();
    aimBone(root, rig.leftUpperArm, WALK_LEFT_ARM);
    aimBone(root, rig.rightUpperArm, WALK_RIGHT_ARM);
    aimBone(root, rig.leftUpperLeg, WALK_LEFT_LEG);
    aimBone(root, rig.rightUpperLeg, WALK_RIGHT_LEG);
  }
}

function findClip(clips: AnimationClip[], mode: CreatorPoseMode) {
  const words = mode === "walk"
    ? ["walk", "walking", "locomotion"]
    : mode === "idle"
      ? ["idle", "stand", "breath"]
      : ["tpose", "t-pose", "apose", "a-pose"];
  return clips.find((clip) => words.some((word) => clean(clip.name).includes(clean(word)))) ?? null;
}

function stripRootMotion(clip: AnimationClip) {
  const cloned = clip.clone();
  cloned.tracks = cloned.tracks.filter((track) => {
    const name = clean(track.name);
    if (!name.includes("position")) return true;
    return !["root", "hips", "pelvis", "armature"].some((token) => name.includes(token));
  });
  cloned.resetDuration();
  return cloned;
}

export function CreatorStudioAvatarViewer({
  modelUrl,
  fallbackModelUrl,
  frontRotationY = 0,
  viewRotationY = 0,
  config,
  poseMode,
  className = "",
  onReady,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef(poseMode);
  const viewRef = useRef(viewRotationY);
  const readyRef = useRef(onReady);

  useEffect(() => { poseRef.current = poseMode; }, [poseMode]);
  useEffect(() => { viewRef.current = viewRotationY; }, [viewRotationY]);
  useEffect(() => { readyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let model: Object3D | null = null;
    let rig: HumanRig | null = null;
    let mixer: AnimationMixer | null = null;
    let action: AnimationAction | null = null;
    let clips: AnimationClip[] = [];
    let activeMode: CreatorPoseMode | null = null;
    let activeView = Number.NaN;
    let baseRotationY = 0;
    const basePosition = new Vector3();
    let needsRefit = false;

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
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.enableZoom = true;
    controls.minDistance = 1.2;
    controls.maxDistance = 8;

    const refit = () => {
      if (!model) return;
      model.updateMatrixWorld(true);
      const rect = mount.getBoundingClientRect();
      const aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      const framed = frameAvatar(camera, model, aspect, 1.28);
      controls.target.copy(framed.center);
      controls.update();
      controls.saveState();
    };

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
      camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      refit();
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
      baseRotationY = model.rotation.y;
      basePosition.copy(model.position);
      clips = gltf.animations.map(stripRootMotion);
      rig = await collectRig(gltf, model);
      mixer = clips.length ? new AnimationMixer(model) : null;
      scene.add(model);
      readyRef.current?.(model, {
        model,
        headBone: rig.head ?? null,
        bones: {
          head: rig.head ?? null,
          neck: rig.neck ?? null,
          chest: rig.chest ?? null,
          upperChest: rig.upperChest ?? null,
          spine: rig.spine ?? null,
          leftHand: rig.leftHand ?? null,
          rightHand: rig.rightHand ?? null,
        },
        refit,
      });
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
      const view = viewRef.current;

      if (model && rig) {
        if (view !== activeView) {
          model.rotation.y = baseRotationY + view;
          activeView = view;
          needsRefit = true;
        }

        if (mode !== activeMode) {
          action?.stop();
          action = null;
          mixer?.stopAllAction();
          resetRig(rig);

          const clip = findClip(clips, mode);
          if (clip && mixer && mode !== "tpose") {
            action = mixer.clipAction(clip);
            action.reset().setEffectiveWeight(1).play();
          }

          activeMode = mode;
          needsRefit = true;
        }

        if (action && mixer) mixer.update(delta);
        else applySafeProceduralPose(model, rig, mode, elapsed);

        model.position.copy(basePosition);
        if (mode === "walk") model.position.y += Math.abs(Math.sin(elapsed * 3.4)) * 0.003;
        model.updateMatrixWorld(true);

        if (needsRefit) {
          needsRefit = false;
          refit();
        }
      }

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
