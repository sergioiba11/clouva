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
  BufferGeometry,
  Clock,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
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
  showSkeleton?: boolean;
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
  leftLowerArm?: Bone;
  rightLowerArm?: Bone;
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
  length: number;
};

type BoneLink = { parent: Bone; child: Bone };

const X_NEGATIVE = new Vector3(-1, 0, 0);
const X_POSITIVE = new Vector3(1, 0, 0);
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
  root.traverse((object: Object3D & { isBone?: boolean; isSkinnedMesh?: boolean; skeleton?: { bones?: Bone[] } }) => {
    if (object.isBone) result.add(object as Bone);
    if (object.isSkinnedMesh) {
      for (const bone of (object as SkinnedMesh).skeleton?.bones ?? []) result.add(bone);
    }
  });
  return [...result];
}

function findByName(bones: Bone[], names: string[]) {
  const wanted = names.map(clean);
  return bones.find((bone) => wanted.includes(clean(bone.name)))
    ?? bones.find((bone) => wanted.some((name) => clean(bone.name).includes(name)));
}

async function resolveVrmBones(gltf: GLTF) {
  const map = new Map<string, Bone>();
  const parser = gltf.parser as unknown as {
    json?: { extensions?: Record<string, unknown> };
    getDependency?: (kind: string, index: number) => Promise<Object3D>;
  };
  const jsonExtensions = parser?.json?.extensions ?? {};
  const userExtensions = (gltf.userData?.gltfExtensions ?? {}) as Record<string, unknown>;
  const extensions = { ...jsonExtensions, ...userExtensions } as {
    VRMC_vrm?: { humanoid?: { humanBones?: Record<string, { node?: number }> } };
    VRM?: { humanoid?: { humanBones?: Array<{ node?: number; bone?: string }> } };
  };

  const vrm1 = extensions.VRMC_vrm?.humanoid?.humanBones;
  if (vrm1 && parser?.getDependency) {
    for (const [name, entry] of Object.entries(vrm1)) {
      if (typeof entry?.node !== "number") continue;
      const node = await parser.getDependency("node", entry.node);
      if ((node as Bone).isBone) map.set(name, node as Bone);
    }
  }

  const vrm0 = extensions.VRM?.humanoid?.humanBones;
  if (Array.isArray(vrm0) && parser?.getDependency) {
    for (const entry of vrm0) {
      if (typeof entry?.node !== "number" || !entry?.bone) continue;
      const node = await parser.getDependency("node", entry.node);
      if ((node as Bone).isBone) map.set(entry.bone, node as Bone);
    }
  }

  return map;
}

function boneChildren(bone: Bone | undefined) {
  return (bone?.children.filter((child): child is Bone => Boolean((child as Bone).isBone)) ?? []);
}

function findDescendantByName(root: Bone | undefined, aliases: string[]) {
  if (!root) return undefined;
  const wanted = aliases.map(clean);
  const queue = [...boneChildren(root)];
  while (queue.length) {
    const current = queue.shift()!;
    const name = clean(current.name);
    if (wanted.includes(name) || wanted.some((alias) => name.includes(alias))) return current;
    queue.push(...boneChildren(current));
  }
  return undefined;
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
      const excluded = ["eye", "jaw", "mouth", "finger", "hand", "weapon", "end", "tip"].some((token) => name.includes(token));
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
    if (["finger", "thumb", "hand", "eye", "jaw", "mouth", "toe", "ear", "palmroot"].some((token) => boneName.includes(token))) continue;
    for (const child of boneChildren(bone)) {
      const start = bone.getWorldPosition(new Vector3());
      const end = child.getWorldPosition(new Vector3());
      const length = end.distanceTo(start);
      if (length < height * 0.025) continue;
      segments.push({
        bone,
        child,
        start,
        end,
        midpoint: start.clone().add(end).multiplyScalar(0.5),
        length,
      });
    }
  }

  const relativeY = (point: Vector3) => (point.y - box.min.y) / height;
  const relativeX = (point: Vector3) => (point.x - centerX) / height;

  const upperArm = (side: -1 | 1) => segments
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

  const upperLeg = (side: -1 | 1) => segments
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
  const leftLowerArm = pick("leftLowerArm", ["leftlowerarm", "leftforearm", "forearml", "lowerarml", "jbiplforearm"])
    ?? findDescendantByName(leftUpperArm, ["leftlowerarm", "leftforearm", "forearm", "lowerarm"])
    ?? boneChildren(leftUpperArm)[0];
  const rightLowerArm = pick("rightLowerArm", ["rightlowerarm", "rightforearm", "forearmr", "lowerarmr", "jbiprforearm"])
    ?? findDescendantByName(rightUpperArm, ["rightlowerarm", "rightforearm", "forearm", "lowerarm"])
    ?? boneChildren(rightUpperArm)[0];
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
    leftLowerArm,
    rightLowerArm,
    leftUpperLeg,
    rightUpperLeg,
    base: new Map(),
    armsReady: Boolean(leftUpperArm && rightUpperArm && leftLowerArm && rightLowerArm),
    walkReady: Boolean(leftUpperArm && rightUpperArm && leftUpperLeg && rightUpperLeg),
  };

  for (const bone of bones) {
    rig.base.set(bone, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
  }

  console.info("[Creator Studio anatomical rig v4]", {
    bones: bones.length,
    head: rig.head?.name,
    leftUpperArm: rig.leftUpperArm?.name,
    rightUpperArm: rig.rightUpperArm?.name,
    leftLowerArm: rig.leftLowerArm?.name,
    rightLowerArm: rig.rightLowerArm?.name,
    leftHand: rig.leftHand?.name,
    rightHand: rig.rightHand?.name,
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

function aimBone(root: Object3D, bone: Bone | undefined, child: Bone | undefined, targetLocal: Vector3) {
  if (!bone || !child) return;
  root.updateMatrixWorld(true);
  bone.getWorldPosition(tmpA);
  child.getWorldPosition(tmpB);
  tmpCurrent.copy(tmpB).sub(tmpA);
  if (tmpCurrent.lengthSq() < 1e-10) return;
  tmpCurrent.normalize();
  root.getWorldQuaternion(tmpRootQ);
  tmpDesired.copy(targetLocal).applyQuaternion(tmpRootQ).normalize();
  bone.parent?.getWorldQuaternion(tmpParentQ);
  tmpParentQ.invert();
  tmpCurrent.applyQuaternion(tmpParentQ).normalize();
  tmpDesired.applyQuaternion(tmpParentQ).normalize();
  tmpDelta.setFromUnitVectors(tmpCurrent, tmpDesired);
  bone.quaternion.premultiply(tmpDelta).normalize();
  bone.updateWorldMatrix(true, true);
}

function outwardAxis(root: Object3D, bone: Bone | undefined) {
  if (!bone) return X_POSITIVE;
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const centerWorld = box.getCenter(new Vector3());
  const boneWorld = bone.getWorldPosition(new Vector3());
  const centerLocal = root.worldToLocal(centerWorld.clone());
  const boneLocal = root.worldToLocal(boneWorld.clone());
  return boneLocal.x >= centerLocal.x ? X_POSITIVE : X_NEGATIVE;
}

function applySafeProceduralPose(root: Object3D, rig: HumanRig, mode: CreatorPoseMode, elapsed: number) {
  resetRig(rig);
  root.updateMatrixWorld(true);

  if (mode === "tpose") {
    if (!rig.armsReady) return;
    const leftAxis = outwardAxis(root, rig.leftUpperArm);
    const rightAxis = outwardAxis(root, rig.rightUpperArm);

    aimBone(root, rig.leftUpperArm, rig.leftLowerArm, leftAxis);
    aimBone(root, rig.leftLowerArm, rig.leftHand ?? boneChildren(rig.leftLowerArm)[0], leftAxis);
    aimBone(root, rig.rightUpperArm, rig.rightLowerArm, rightAxis);
    aimBone(root, rig.rightLowerArm, rig.rightHand ?? boneChildren(rig.rightLowerArm)[0], rightAxis);
    return;
  }

  if (mode === "walk") {
    if (!rig.walkReady) return;
    const step = Math.sin(elapsed * 3.4);
    WALK_LEFT_ARM.set(-0.11, -0.99, step * 0.08).normalize();
    WALK_RIGHT_ARM.set(0.11, -0.99, -step * 0.08).normalize();
    WALK_LEFT_LEG.set(-0.025, -0.997, -step * 0.07).normalize();
    WALK_RIGHT_LEG.set(0.025, -0.997, step * 0.07).normalize();
    aimBone(root, rig.leftUpperArm, rig.leftLowerArm, WALK_LEFT_ARM);
    aimBone(root, rig.rightUpperArm, rig.rightLowerArm, WALK_RIGHT_ARM);
    aimBone(root, rig.leftUpperLeg, boneChildren(rig.leftUpperLeg)[0], WALK_LEFT_LEG);
    aimBone(root, rig.rightUpperLeg, boneChildren(rig.rightUpperLeg)[0], WALK_RIGHT_LEG);
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

function hiddenPreviewBone(name: string) {
  const normalized = clean(name);
  return normalized.startsWith("clouvaear")
    || normalized === "headend"
    || normalized.endsWith("end")
    || normalized.endsWith("tip")
    || normalized.endsWith("nub")
    || normalized.includes("effector")
    || normalized.includes("weapon");
}

function buildPreviewLinks(root: Object3D): BoneLink[] {
  const links: BoneLink[] = [];
  for (const child of uniqueBones(root)) {
    const parent = child.parent;
    if (!(parent instanceof Bone)) continue;
    const childName = clean(child.name);
    const parentName = clean(parent.name);
    if (hiddenPreviewBone(child.name) || hiddenPreviewBone(parent.name)) continue;
    // Las raíces técnicas de palma evitan heredar escala, pero el enlace mano→raíz
    // no representa un hueso anatómico y no debe verse en el visor.
    if (childName.startsWith("clouvapalmroot")) continue;
    // Las orejas son auxiliares de pesos. Ocultar sus enlaces evita líneas desde
    // el origen del hueso Head (cuello) hacia los costados de la cara.
    if (childName.startsWith("clouvaear") || parentName.startsWith("clouvaear")) continue;
    links.push({ parent, child });
  }
  return links;
}

function createSkeletonPreview(root: Object3D) {
  const links = buildPreviewLinks(root);
  const positions = new Float32Array(Math.max(links.length * 6, 6));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color: 0x57e6c2, transparent: true, opacity: 0.96 });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 20;

  const update = () => {
    const attribute = geometry.getAttribute("position") as Float32BufferAttribute;
    const array = attribute.array as Float32Array;
    let offset = 0;
    for (const link of links) {
      link.parent.getWorldPosition(tmpA);
      link.child.getWorldPosition(tmpB);
      array[offset++] = tmpA.x;
      array[offset++] = tmpA.y;
      array[offset++] = tmpA.z;
      array[offset++] = tmpB.x;
      array[offset++] = tmpB.y;
      array[offset++] = tmpB.z;
    }
    while (offset < array.length) array[offset++] = 0;
    attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
  };

  return {
    lines,
    update,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function CreatorStudioAvatarViewer({
  modelUrl,
  fallbackModelUrl,
  frontRotationY = 0,
  viewRotationY = 0,
  config,
  poseMode,
  className = "",
  showSkeleton = false,
  onReady,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef(poseMode);
  const viewRef = useRef(viewRotationY);
  const readyRef = useRef(onReady);
  const showSkeletonRef = useRef(showSkeleton);

  useEffect(() => { poseRef.current = poseMode; }, [poseMode]);
  useEffect(() => { viewRef.current = viewRotationY; }, [viewRotationY]);
  useEffect(() => { readyRef.current = onReady; }, [onReady]);
  useEffect(() => { showSkeletonRef.current = showSkeleton; }, [showSkeleton]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let model: Object3D | null = null;
    let rig: HumanRig | null = null;
    let skeletonPreview: ReturnType<typeof createSkeletonPreview> | null = null;
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
      gltf.scene.traverse((child: Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean; frustumCulled?: boolean; normalizeSkinWeights?: () => void }) => {
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

      skeletonPreview?.dispose();
      if (skeletonPreview) scene.remove(skeletonPreview.lines);
      skeletonPreview = createSkeletonPreview(model);
      skeletonPreview.lines.visible = showSkeletonRef.current;
      scene.add(skeletonPreview.lines);

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
        skeletonPreview?.update();

        if (needsRefit) {
          needsRefit = false;
          refit();
        }
      }

      if (skeletonPreview) skeletonPreview.lines.visible = showSkeletonRef.current;
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
      skeletonPreview?.dispose();
      controls.dispose();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, frontRotationY, config]);

  return <div ref={mountRef} className={className} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: 500 }} />;
}
