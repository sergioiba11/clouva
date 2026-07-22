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
  Group,
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
};

type BoneLink = { parent: Bone; child: Bone };

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpCurrentDirection = new Vector3();
const tmpTargetDirection = new Vector3();
const tmpCenter = new Vector3();
const tmpShoulder = new Vector3();
const tmpCenterLocal = new Vector3();
const tmpShoulderLocal = new Vector3();
const tmpRootWorldQuaternion = new Quaternion();
const tmpBoneWorldQuaternion = new Quaternion();
const tmpParentWorldQuaternion = new Quaternion();
const tmpDesiredWorldQuaternion = new Quaternion();
const tmpDeltaWorldQuaternion = new Quaternion();

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

function boneChildren(bone: Bone | undefined) {
  return (bone?.children.filter((child): child is Bone => Boolean((child as Bone).isBone)) ?? []);
}

function findByName(bones: Bone[], aliases: string[]) {
  const wanted = aliases.map(clean);
  return bones.find((bone) => wanted.includes(clean(bone.name)))
    ?? bones.find((bone) => wanted.some((alias) => clean(bone.name).includes(alias)));
}

function findDescendantByName(root: Bone | undefined, aliases: string[]) {
  if (!root) return undefined;
  const wanted = aliases.map(clean);
  const queue = [...boneChildren(root)];
  while (queue.length) {
    const bone = queue.shift()!;
    const name = clean(bone.name);
    if (wanted.includes(name) || wanted.some((alias) => name.includes(alias))) return bone;
    queue.push(...boneChildren(bone));
  }
  return undefined;
}

function isPalmRoot(name: string) {
  return clean(name).startsWith("clouvapalmroot");
}

function isEarBone(name: string) {
  return clean(name).startsWith("clouvaear");
}

function fingerInfo(name: string) {
  const match = name.toLowerCase().match(/^clouva_(thumb|index|middle|ring|pinky)_(\d{2})_([lr])$/);
  if (!match) return null;
  return { finger: match[1], segment: Number(match[2]), side: match[3] };
}

function isUnsafeHelper(name: string) {
  const normalized = clean(name);
  return normalized.endsWith("end")
    || normalized.endsWith("tip")
    || normalized.endsWith("nub")
    || normalized.includes("effector")
    || normalized.includes("weapon");
}

function firstUsableBoneChild(bone: Bone | undefined) {
  return boneChildren(bone).find((child) => !isPalmRoot(child.name) && !isEarBone(child.name) && !isUnsafeHelper(child.name))
    ?? boneChildren(bone)[0];
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
      if (typeof entry?.node !== "number" || !entry.bone) continue;
      const node = await parser.getDependency("node", entry.node);
      if ((node as Bone).isBone) map.set(entry.bone, node as Bone);
    }
  }
  return map;
}

function geometricArm(root: Object3D, bones: Bone[], side: -1 | 1) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const center = box.getCenter(new Vector3());
  const height = Math.max(box.max.y - box.min.y, 0.001);

  return bones
    .map((bone) => {
      const child = firstUsableBoneChild(bone);
      const start = bone.getWorldPosition(new Vector3());
      const end = child?.getWorldPosition(new Vector3());
      return { bone, child, start, end };
    })
    .filter((item): item is { bone: Bone; child: Bone; start: Vector3; end: Vector3 } => Boolean(item.child && item.end))
    .filter(({ bone, start, end }) => {
      const name = clean(bone.name);
      if (["finger", "thumb", "hand", "eye", "jaw", "toe", "ear", "palm"].some((token) => name.includes(token))) return false;
      const relativeY = (start.y - box.min.y) / height;
      const lateral = ((start.x - center.x) / height) * side;
      const length = start.distanceTo(end);
      return relativeY > 0.52 && relativeY < 0.82 && lateral > 0.02 && length < height * 0.28;
    })
    .sort((a, b) => {
      const score = (item: { start: Vector3; end: Vector3 }) => {
        const y = (item.start.y - box.min.y) / height;
        const length = item.start.distanceTo(item.end) / height;
        return Math.abs(y - 0.67) + Math.abs(length - 0.13);
      };
      return score(a) - score(b);
    })[0]?.bone;
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

async function collectRig(gltf: GLTF, root: Object3D): Promise<HumanRig> {
  const bones = uniqueBones(root);
  const vrm = await resolveVrmBones(gltf);
  const pick = (vrmName: string, aliases: string[]) => vrm.get(vrmName) ?? findByName(bones, aliases);

  const leftUpperArm = pick("leftUpperArm", ["leftupperarm", "leftarm", "upperarml", "arml", "jbiplupperarm", "lupperarm"])
    ?? geometricArm(root, bones, -1);
  const rightUpperArm = pick("rightUpperArm", ["rightupperarm", "rightarm", "upperarmr", "armr", "jbiprupperarm", "rupperarm"])
    ?? geometricArm(root, bones, 1);
  const leftLowerArm = pick("leftLowerArm", ["leftlowerarm", "leftforearm", "forearml", "lowerarml", "jbiplforearm"])
    ?? findDescendantByName(leftUpperArm, ["leftlowerarm", "leftforearm", "forearm", "lowerarm"])
    ?? firstUsableBoneChild(leftUpperArm);
  const rightLowerArm = pick("rightLowerArm", ["rightlowerarm", "rightforearm", "forearmr", "lowerarmr", "jbiprforearm"])
    ?? findDescendantByName(rightUpperArm, ["rightlowerarm", "rightforearm", "forearm", "lowerarm"])
    ?? firstUsableBoneChild(rightUpperArm);

  const rig: HumanRig = {
    head: pick("head", ["head", "jbipchead", "bip01head"]) ?? highestCentralBone(root, bones),
    neck: pick("neck", ["neck", "neck1", "jbipcneck"]),
    chest: pick("chest", ["chest", "defchest", "spine2", "mixamorigspine2"]),
    upperChest: pick("upperChest", ["upperchest", "defupperchest", "spine3", "mixamorigspine2"]),
    spine: pick("spine", ["spine1", "spine", "defspine", "mixamorigspine1", "mixamorigspine"]),
    leftHand: pick("leftHand", ["lefthand", "handl", "defhandl", "jbiplhand"]),
    rightHand: pick("rightHand", ["righthand", "handr", "defhandr", "jbiprhand"]),
    leftUpperArm,
    rightUpperArm,
    leftLowerArm,
    rightLowerArm,
    leftUpperLeg: pick("leftUpperLeg", ["leftupperleg", "leftupleg", "thighl", "jbiplupperleg", "upperlegl"]),
    rightUpperLeg: pick("rightUpperLeg", ["rightupperleg", "rightupleg", "thighr", "jbiprupperleg", "upperlegr"]),
    base: new Map(),
    armsReady: Boolean(leftUpperArm && rightUpperArm && leftLowerArm && rightLowerArm),
  };

  for (const bone of bones) {
    rig.base.set(bone, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
  }

  console.info("[Creator Studio rig v6 head-ears-fingers]", {
    bones: bones.length,
    head: rig.head?.name,
    leftUpperArm: rig.leftUpperArm?.name,
    leftLowerArm: rig.leftLowerArm?.name,
    leftHand: rig.leftHand?.name,
    rightUpperArm: rig.rightUpperArm?.name,
    rightLowerArm: rig.rightLowerArm?.name,
    rightHand: rig.rightHand?.name,
  });
  return rig;
}

function resetRig(rig: HumanRig) {
  for (const [bone, base] of rig.base) {
    bone.quaternion.copy(base.quaternion);
    bone.position.copy(base.position);
  }
}

function outwardWorldDirection(root: Object3D, shoulder: Bone) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  box.getCenter(tmpCenter);
  shoulder.getWorldPosition(tmpShoulder);
  tmpCenterLocal.copy(tmpCenter);
  tmpShoulderLocal.copy(tmpShoulder);
  root.worldToLocal(tmpCenterLocal);
  root.worldToLocal(tmpShoulderLocal);
  const sign = tmpShoulderLocal.x >= tmpCenterLocal.x ? 1 : -1;
  root.getWorldQuaternion(tmpRootWorldQuaternion);
  return tmpTargetDirection.set(sign, 0, 0).applyQuaternion(tmpRootWorldQuaternion).normalize().clone();
}

function alignBoneInWorld(root: Object3D, bone: Bone | undefined, child: Bone | undefined, targetWorldDirection: Vector3) {
  if (!bone || !child) return;
  root.updateMatrixWorld(true);
  bone.getWorldPosition(tmpA);
  child.getWorldPosition(tmpB);
  tmpCurrentDirection.copy(tmpB).sub(tmpA);
  if (tmpCurrentDirection.lengthSq() < 1e-10) return;
  tmpCurrentDirection.normalize();
  tmpTargetDirection.copy(targetWorldDirection).normalize();

  tmpDeltaWorldQuaternion.setFromUnitVectors(tmpCurrentDirection, tmpTargetDirection);
  bone.getWorldQuaternion(tmpBoneWorldQuaternion);
  tmpDesiredWorldQuaternion.copy(tmpDeltaWorldQuaternion).multiply(tmpBoneWorldQuaternion).normalize();

  if (bone.parent) bone.parent.getWorldQuaternion(tmpParentWorldQuaternion);
  else tmpParentWorldQuaternion.identity();
  tmpParentWorldQuaternion.invert();
  bone.quaternion.copy(tmpParentWorldQuaternion.multiply(tmpDesiredWorldQuaternion)).normalize();
  bone.updateWorldMatrix(true, true);
}

function applyProceduralPose(root: Object3D, rig: HumanRig, mode: CreatorPoseMode) {
  resetRig(rig);
  root.updateMatrixWorld(true);
  if (mode !== "tpose" || !rig.armsReady) return;

  const leftDirection = outwardWorldDirection(root, rig.leftUpperArm!);
  const rightDirection = outwardWorldDirection(root, rig.rightUpperArm!);

  alignBoneInWorld(root, rig.leftUpperArm, rig.leftLowerArm, leftDirection);
  alignBoneInWorld(root, rig.leftLowerArm, rig.leftHand ?? firstUsableBoneChild(rig.leftLowerArm), leftDirection);
  alignBoneInWorld(root, rig.rightUpperArm, rig.rightLowerArm, rightDirection);
  alignBoneInWorld(root, rig.rightLowerArm, rig.rightHand ?? firstUsableBoneChild(rig.rightLowerArm), rightDirection);
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

function nearestPreviewAncestor(child: Bone) {
  let current: Object3D | null = child.parent;
  while (current) {
    if ((current as Bone).isBone) {
      const bone = current as Bone;
      if (!isPalmRoot(bone.name) && !isEarBone(bone.name) && !isUnsafeHelper(bone.name)) return bone;
    }
    current = current.parent;
  }
  return null;
}

function buildBasePreviewLinks(root: Object3D) {
  const links: BoneLink[] = [];
  const seen = new Set<string>();

  for (const child of uniqueBones(root)) {
    const finger = fingerInfo(child.name);
    if (isPalmRoot(child.name) || isEarBone(child.name) || isUnsafeHelper(child.name)) continue;
    // No dibujar mano→raíz de cada dedo: era la "espina" horizontal de la captura.
    if (finger?.segment === 1) continue;

    const parent = nearestPreviewAncestor(child);
    if (!parent || parent === child) continue;
    const parentFinger = fingerInfo(parent.name);
    if (finger && (!parentFinger || parentFinger.finger !== finger.finger || parentFinger.side !== finger.side)) continue;

    const key = `${parent.uuid}:${child.uuid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ parent, child });
  }
  return links;
}

function createSkeletonPreview(root: Object3D, rig: HumanRig) {
  root.updateMatrixWorld(true);
  const bones = uniqueBones(root);
  const links = buildBasePreviewLinks(root);
  const ears = bones.filter((bone) => isEarBone(bone.name));
  const fingerTips = bones.filter((bone) => fingerInfo(bone.name)?.segment === 3);
  const box = new Box3().setFromObject(root);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  const maxLinkLength = height * 0.45;
  const segmentCapacity = links.length + 1 + ears.length + fingerTips.length;
  const linePositions = new Float32Array(Math.max(segmentCapacity * 6, 6));

  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute("position", new Float32BufferAttribute(linePositions, 3));
  const lineMaterial = new LineBasicMaterial({ color: 0x57e6c2, transparent: true, opacity: 0.98, depthTest: false });
  const lines = new LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  lines.renderOrder = 100;

  const group = new Group();
  group.add(lines);

  const writeLine = (array: Float32Array, offset: number, start: Vector3, end: Vector3) => {
    array[offset++] = start.x;
    array[offset++] = start.y;
    array[offset++] = start.z;
    array[offset++] = end.x;
    array[offset++] = end.y;
    array[offset++] = end.z;
    return offset;
  };

  const update = () => {
    root.updateMatrixWorld(true);
    const lineAttribute = lineGeometry.getAttribute("position") as Float32BufferAttribute;
    const lineArray = lineAttribute.array as Float32Array;
    let lineOffset = 0;

    for (const link of links) {
      link.parent.getWorldPosition(tmpA);
      link.child.getWorldPosition(tmpB);
      const distance = tmpA.distanceTo(tmpB);
      if (distance <= height * 0.001 || distance > maxLinkLength) continue;
      lineOffset = writeLine(lineArray, lineOffset, tmpA, tmpB);
    }

    // El joint Head suele ser hoja en glTF. Dibujamos el volumen óseo hacia la coronilla.
    if (rig.head) {
      rig.head.getWorldPosition(tmpA);
      const headEnd = boneChildren(rig.head).find((bone) => {
        const name = clean(bone.name);
        return name.includes("headend") || name.includes("headtip");
      });
      let usedRealEnd = false;
      if (headEnd) {
        headEnd.getWorldPosition(tmpB);
        const distance = tmpA.distanceTo(tmpB);
        if (distance >= height * 0.025 && distance <= height * 0.18) {
          lineOffset = writeLine(lineArray, lineOffset, tmpA, tmpB);
          usedRealEnd = true;
        }
      }
      if (!usedRealEnd) {
        root.getWorldQuaternion(tmpRootWorldQuaternion);
        tmpB.copy(tmpA).add(tmpC.set(0, 1, 0).applyQuaternion(tmpRootWorldQuaternion).normalize().multiplyScalar(height * 0.095));
        lineOffset = writeLine(lineArray, lineOffset, tmpA, tmpB);
      }
    }

    // Las orejas se dibujan con un único segmento corto hacia afuera, sin cruces flotantes.
    root.getWorldQuaternion(tmpRootWorldQuaternion);
    const right = tmpB.set(1, 0, 0).applyQuaternion(tmpRootWorldQuaternion).normalize().clone();
    box.getCenter(tmpCenter);
    for (const ear of ears) {
      ear.getWorldPosition(tmpA);
      const sign = tmpA.x >= tmpCenter.x ? 1 : -1;
      tmpC.copy(tmpA).addScaledVector(right, sign * height * 0.020);
      lineOffset = writeLine(lineArray, lineOffset, tmpA, tmpC);
    }

    // glTF no conserva el tail del último hueso. Proyectamos la última falange desde 02→03.
    for (const tip of fingerTips) {
      const parent = nearestPreviewAncestor(tip);
      tip.getWorldPosition(tmpB);
      if (parent && fingerInfo(parent.name)) {
        parent.getWorldPosition(tmpA);
        tmpCurrentDirection.copy(tmpB).sub(tmpA);
      } else {
        box.getCenter(tmpA);
        tmpCurrentDirection.copy(tmpB).sub(tmpA);
      }
      if (tmpCurrentDirection.lengthSq() < 1e-10) continue;
      const previousLength = Math.max(tmpCurrentDirection.length(), height * 0.007);
      tmpCurrentDirection.normalize();
      tmpC.copy(tmpB).addScaledVector(tmpCurrentDirection, Math.min(previousLength * 0.78, height * 0.018));
      lineOffset = writeLine(lineArray, lineOffset, tmpB, tmpC);
    }

    while (lineOffset < lineArray.length) lineArray[lineOffset++] = 0;
    lineAttribute.needsUpdate = true;
    lineGeometry.computeBoundingSphere();

  };

  return {
    group,
    update,
    dispose: () => {
      lineGeometry.dispose();
      lineMaterial.dispose();
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
    const camera = new PerspectiveCamera(31, 1, 0.005, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 768 ? 1 : 1.5));
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x160b25, 1.65));
    scene.add(new AmbientLight(0xffffff, 0.55));
    const light = new DirectionalLight(0xffffff, 2.25);
    light.position.set(3, 5, 4);
    scene.add(light);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI - 0.12;
    controls.minDistance = 0.35;
    controls.maxDistance = 12;

    const refit = () => {
      if (!model) return;
      model.updateMatrixWorld(true);
      const rect = mount.getBoundingClientRect();
      const aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      const framed = frameAvatar(camera, model, aspect, 1.28);
      const fittedDistance = Math.max(camera.position.distanceTo(framed.center), 0.1);
      camera.near = Math.max(0.002, fittedDistance / 1000);
      camera.far = Math.max(100, fittedDistance * 30);
      camera.updateProjectionMatrix();
      controls.target.copy(framed.center);
      controls.minDistance = Math.max(0.28, fittedDistance * 0.22);
      controls.maxDistance = Math.max(8, fittedDistance * 4);
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

    const handleDoubleClick = () => refit();
    renderer.domElement.addEventListener("dblclick", handleDoubleClick);

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

      skeletonPreview = createSkeletonPreview(model, rig);
      skeletonPreview.group.visible = showSkeletonRef.current;
      scene.add(skeletonPreview.group);

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
        else applyProceduralPose(model, rig, mode);

        model.position.copy(basePosition);
        if (mode === "walk") model.position.y += Math.abs(Math.sin(elapsed * 3.4)) * 0.003;
        model.updateMatrixWorld(true);
        skeletonPreview?.update();

        if (needsRefit) {
          needsRefit = false;
          refit();
        }
      }

      if (skeletonPreview) skeletonPreview.group.visible = showSkeletonRef.current;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("dblclick", handleDoubleClick);
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
