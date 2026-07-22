"use client";

import { useEffect, useRef } from "react";
import {
  Bone,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { frameAvatar, normalizeAvatarObject } from "@/lib/avatar-engine/frame-avatar";
import type { AvatarConfig } from "@/lib/avatar-engine/types";
import {
  CreatorStudioAvatarViewer as BaseViewer,
  type CreatorPoseMode,
  type CreatorStudioAvatarContext,
} from "./CreatorStudioAvatarViewerV6";

export type { CreatorPoseMode, CreatorStudioAvatarContext };

export type AnchorBoneKey = "head" | "neck" | "chest" | "upperChest" | "spine" | "leftHand" | "rightHand";

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

type BoneLink = { parent: Bone; child: Bone };

type FingerInfo = {
  finger: string;
  segment: number;
  side: "l" | "r";
};

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpDirection = new Vector3();
const tmpRootQuaternion = new Quaternion();

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

function fingerInfo(name: string): FingerInfo | null {
  const match = name.toLowerCase().match(/^clouva_(thumb|index|middle|ring|pinky)_(\d{2})_([lr])$/);
  if (!match) return null;
  return { finger: match[1], segment: Number(match[2]), side: match[3] as "l" | "r" };
}

function isPalmRoot(name: string) {
  return clean(name).startsWith("clouvapalmroot");
}

function isEarBone(name: string) {
  return clean(name).startsWith("clouvaear");
}

function isUnsafeHelper(name: string) {
  const normalized = clean(name);
  return normalized === "headend"
    || normalized.endsWith("end")
    || normalized.endsWith("tip")
    || normalized.endsWith("nub")
    || normalized.includes("effector")
    || normalized.includes("weapon");
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

function buildLinks(root: Object3D) {
  const links: BoneLink[] = [];
  const seen = new Set<string>();
  for (const child of uniqueBones(root)) {
    const childFinger = fingerInfo(child.name);
    if (isPalmRoot(child.name) || isEarBone(child.name) || isUnsafeHelper(child.name)) continue;
    if (childFinger?.segment === 1) continue;
    const parent = nearestPreviewAncestor(child);
    if (!parent || parent === child) continue;
    const parentFinger = fingerInfo(parent.name);
    if (childFinger && (!parentFinger || parentFinger.finger !== childFinger.finger || parentFinger.side !== childFinger.side)) continue;
    const key = `${parent.uuid}:${child.uuid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ parent, child });
  }
  return links;
}

function findHead(bones: Bone[]) {
  const exact = bones.find((bone) => ["head", "headbone", "jbiphead", "bip01head"].includes(clean(bone.name)));
  return exact ?? bones.find((bone) => {
    const name = clean(bone.name);
    return name.includes("head") && !["end", "tip", "terminal", "effector"].some((token) => name.includes(token));
  }) ?? null;
}

function SkeletonOverlay({ modelUrl, fallbackModelUrl, frontRotationY = 0, viewRotationY = 0 }: Pick<Props, "modelUrl" | "fallbackModelUrl" | "frontRotationY" | "viewRotationY">) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let frame = 0;
    let model: Object3D | null = null;
    let lineGeometry: BufferGeometry | null = null;
    let lineMaterial: LineBasicMaterial | null = null;

    const scene = new Scene();
    const camera = new PerspectiveCamera(31, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 768 ? 1 : 1.5));
    mount.appendChild(renderer.domElement);

    const resize = () => {
      if (!model) return;
      const rect = mount.getBoundingClientRect();
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
      camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      const framed = frameAvatar(camera, model, camera.aspect, 1.28);
      camera.lookAt(framed.center);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const attach = async (url: string) => {
      const gltf = await loader.loadAsync(url);
      if (disposed) return;
      normalizeAvatarObject(gltf.scene, { targetHeight: 2.05, frontRotationY });
      gltf.scene.rotation.y += viewRotationY;
      gltf.scene.traverse((child: Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean }) => {
        if (child.isMesh || child.isSkinnedMesh) child.visible = false;
      });
      model = gltf.scene;
      model.updateMatrixWorld(true);
      scene.add(model);

      const bones = uniqueBones(model);
      const links = buildLinks(model);
      const head = findHead(bones);
      const headEnd = head?.children.find((child) => {
        const name = clean(child.name);
        return (child as Bone).isBone && (name.includes("headend") || name.includes("headtip"));
      }) as Bone | undefined;
      const ears = bones.filter((bone) => isEarBone(bone.name));
      const fingerTips = bones.filter((bone) => fingerInfo(bone.name)?.segment === 3);
      const box = new Box3().setFromObject(model);
      const center = box.getCenter(new Vector3());
      const height = Math.max(box.max.y - box.min.y, 0.001);
      const capacity = links.length + 1 + ears.length + fingerTips.length;
      const positions = new Float32Array(Math.max(capacity * 6, 6));
      lineGeometry = new BufferGeometry();
      lineGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      lineMaterial = new LineBasicMaterial({ color: 0x57e6c2, transparent: true, opacity: 0.98, depthTest: false });
      const lines = new LineSegments(lineGeometry, lineMaterial);
      lines.frustumCulled = false;
      lines.renderOrder = 120;
      scene.add(lines);

      const writeLine = (array: Float32Array, offset: number, start: Vector3, end: Vector3) => {
        array[offset++] = start.x;
        array[offset++] = start.y;
        array[offset++] = start.z;
        array[offset++] = end.x;
        array[offset++] = end.y;
        array[offset++] = end.z;
        return offset;
      };

      const updateLines = () => {
        if (!model || !lineGeometry) return;
        model.updateMatrixWorld(true);
        const attribute = lineGeometry.getAttribute("position") as Float32BufferAttribute;
        const array = attribute.array as Float32Array;
        let offset = 0;
        for (const link of links) {
          link.parent.getWorldPosition(tmpA);
          link.child.getWorldPosition(tmpB);
          const distance = tmpA.distanceTo(tmpB);
          if (distance < height * 0.001 || distance > height * 0.45) continue;
          offset = writeLine(array, offset, tmpA, tmpB);
        }

        if (head) {
          head.getWorldPosition(tmpA);
          let validEnd = false;
          if (headEnd) {
            headEnd.getWorldPosition(tmpB);
            const distance = tmpA.distanceTo(tmpB);
            if (distance >= height * 0.025 && distance <= height * 0.20) {
              offset = writeLine(array, offset, tmpA, tmpB);
              validEnd = true;
            }
          }
          if (!validEnd) {
            model.getWorldQuaternion(tmpRootQuaternion);
            tmpB.copy(tmpA).add(tmpC.set(0, 1, 0).applyQuaternion(tmpRootQuaternion).normalize().multiplyScalar(height * 0.095));
            offset = writeLine(array, offset, tmpA, tmpB);
          }
        }

        model.getWorldQuaternion(tmpRootQuaternion);
        const right = tmpDirection.set(1, 0, 0).applyQuaternion(tmpRootQuaternion).normalize().clone();
        for (const ear of ears) {
          ear.getWorldPosition(tmpA);
          const sign = tmpA.x >= center.x ? 1 : -1;
          tmpB.copy(tmpA).addScaledVector(right, sign * height * 0.020);
          offset = writeLine(array, offset, tmpA, tmpB);
        }

        for (const tip of fingerTips) {
          const parent = nearestPreviewAncestor(tip);
          if (!parent || !fingerInfo(parent.name)) continue;
          parent.getWorldPosition(tmpA);
          tip.getWorldPosition(tmpB);
          tmpDirection.copy(tmpB).sub(tmpA);
          if (tmpDirection.lengthSq() < 1e-10) continue;
          const previousLength = tmpDirection.length();
          tmpDirection.normalize();
          tmpC.copy(tmpB).addScaledVector(tmpDirection, Math.min(previousLength * 0.78, height * 0.018));
          offset = writeLine(array, offset, tmpB, tmpC);
        }

        while (offset < array.length) array[offset++] = 0;
        attribute.needsUpdate = true;
        lineGeometry.computeBoundingSphere();
      };

      resize();
      const animate = () => {
        updateLines();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    };

    void (async () => {
      try {
        if (modelUrl) await attach(modelUrl);
        else if (fallbackModelUrl) await attach(fallbackModelUrl);
      } catch (error) {
        console.warn("Creator Studio anatomical overlay failed", error);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      lineGeometry?.dispose();
      lineMaterial?.dispose();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [modelUrl, fallbackModelUrl, frontRotationY, viewRotationY]);

  return <div ref={mountRef} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }} />;
}

export function CreatorStudioAvatarViewer({ className = "", showSkeleton = false, ...props }: Props) {
  return (
    <div className={className} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: 500 }}>
      <BaseViewer {...props} className="" showSkeleton={false} />
      {showSkeleton ? (
        <SkeletonOverlay
          modelUrl={props.modelUrl}
          fallbackModelUrl={props.fallbackModelUrl}
          frontRotationY={props.frontRotationY}
          viewRotationY={props.viewRotationY}
        />
      ) : null}
    </div>
  );
}
