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
};

type BoneLink = { parent: Bone; child: Bone };

const tmpA = new Vector3();
const tmpB = new Vector3();
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

function firstVisibleBoneChild(bone: Bone | undefined) {
  return boneChildren(bone).find((child) => !isTechnicalBone(child.name)) ?? boneChildren(bone)[0];
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
      const child = firstVisibleBoneChild(bone);
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
    ?? firstVisibleBoneChild(leftUpperArm);
  const rightLowerArm = pick("rightLowerArm", ["rightlowerarm", "rightforearm", "forearmr", "lowerarmr", "jbiprforearm"])
    ?? findDescendantByName(rightUpperArm, ["rightlowerarm", "rightforearm", "forearm", "lowerarm"])
    ?? firstVisibleBoneChild(rightUpperArm);

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

  console.info("[Creator Studio rig v5 world-space]", {
    bones: bones.length,
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
  alignBoneInWorld(root, rig.leftLowerArm, rig.leftHand ?? firstVisibleBoneChild(rig.leftLowerArm), leftDirection);
  alignBoneInWorld(root, rig.rightUpperArm, rig.rightLowerArm, rightDirection);
  alignBoneInWorld(root, rig.rightLowerArm, rig.rightHand ?? firstVisibleBoneChild(rig.rightLowerArm), rightDirection);
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

function isTechnicalBone(name: string) {
  const normalized = clean(name);
  return normalized.startsWith("clouvapalmroot")
    || normalized.startsWith("clouvaear")
    || normalized === "headend"
    || normalized.endsWith("end")
    || normalized.endsWith("tip")
    || normalized.endsWith("nub")
    || normalized.includes("effector")
    || normalized.includes("weapon");
}

function nearestVisibleBoneAncestor(child: Bone) {
  let current: Object3D | null = child.parent;
  while (current) {
    if ((current as Bone).isBone && !isTechnicalBone(current.name)) return current as Bone;
    current = current.parent;
  }
  return null;
}

function buildPreviewLinks(root: Object3D) {
  const links: BoneLink[] = [];
  const seen = new Set<string>();
  for (const child of uniqueBones(root)) {
    if (isTechnicalBone(child.name)) continue;
    const parent = nearestVisibleBoneAncestor(child);
    if (!parent || parent === child) continue;
    const key = `${parent.uuid}:${child.uuid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ parent, child });
  }
  return links;
}

function createSkeletonPreview(root: Object3D) {
  root.updateMatrixWorld(true);
  const links = buildPreviewLinks(root);
  const box = new Box3().setFromObject(root);
  const maxLinkLength = Math.max(box.max.y - box.min.y, 0.001) * 0.45;
  const positions = new Float32Array(Math.max(links.length * 6, 6));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color: 0x57e6c2, transparent: true, opacity: 0.98, depthTest: false });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 100;

  const update = () => {
    const attribute = geometry.getAttribute("position") as Float32BufferAttribute;
    const array = attribute.array as Float32Array;
    let offset = 0;
    for (const link of links) {
      link.parent.getWorldPosition(tmpA);
      link.child.getWorldPosition(tmpB);
      if (tmpA.distanceTo(tmpB) > maxLinkLength) continue;
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
