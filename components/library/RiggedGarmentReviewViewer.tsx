"use client";

import { useEffect, useRef, useState } from "react";
import { Bone, Mesh, Object3D, SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  CreatorStudioAvatarViewer,
  type CreatorPoseMode,
} from "@/components/creator-studio/CreatorStudioAvatarViewer";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";

export type RiggedReviewPose = "Idle" | "T-Pose" | "Walk";
export type RiggedReviewView = "Frente" | "Lateral" | "Espalda";

type Props = {
  modelUrl: string;
  pose: RiggedReviewPose;
  view: RiggedReviewView;
  onStatus?: (status: string) => void;
};

type BonePair = {
  source: Bone;
  target: Bone;
};

function cleanBoneName(value: string) {
  return value
    .toLowerCase()
    .replace(/^mixamorig[:_]?/, "")
    .replace(/^armature[|/.:_-]?/, "")
    .replace(/[^a-z0-9]/g, "");
}

function collectBones(root: Object3D) {
  const map = new Map<string, Bone>();
  root.traverse((object: any) => {
    if (!object.isBone) return;
    const bone = object as Bone;
    const key = cleanBoneName(bone.name);
    if (key && !map.has(key)) map.set(key, bone);
  });
  return map;
}

function disposeObject(root: Object3D | null) {
  if (!root) return;
  root.removeFromParent();
  root.traverse((object: any) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) material?.dispose?.();
  });
}

export function RiggedGarmentReviewViewer({ modelUrl, pose, view, onStatus }: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarRootRef = useRef<Object3D | null>(null);
  const avatarBonesRef = useRef<Map<string, Bone>>(new Map());
  const garmentRootRef = useRef<Object3D | null>(null);
  const bonePairsRef = useRef<BonePair[]>([]);
  const frameRef = useRef(0);
  const statusRef = useRef(onStatus);
  const [avatarRevision, setAvatarRevision] = useState(0);

  statusRef.current = onStatus;

  const viewRotationY = view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI;
  const poseMode: CreatorPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  const attachAvatar = (root: Object3D) => {
    avatarRootRef.current = root;
    avatarBonesRef.current = collectBones(root);
    setAvatarRevision((value) => value + 1);
  };

  useEffect(() => {
    let cancelled = false;
    disposeObject(garmentRootRef.current);
    garmentRootRef.current = null;
    bonePairsRef.current = [];

    const avatarRoot = avatarRootRef.current;
    if (!avatarRoot || !modelUrl) {
      statusRef.current?.("Cargando el avatar riggeado…");
      return;
    }

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    statusRef.current?.("Cargando la prenda riggeada real…");

    void loader.loadAsync(modelUrl).then((gltf) => {
      if (cancelled || !avatarRootRef.current) return;

      const garmentRoot = gltf.scene;
      let skinnedMeshCount = 0;
      let meshCount = 0;
      garmentRoot.traverse((object: any) => {
        if ((object as Mesh).isMesh || (object as SkinnedMesh).isSkinnedMesh) {
          meshCount += 1;
          object.visible = true;
          object.frustumCulled = false;
          object.castShadow = true;
          object.receiveShadow = true;
        }
        if ((object as SkinnedMesh).isSkinnedMesh) {
          skinnedMeshCount += 1;
          (object as SkinnedMesh).normalizeSkinWeights();
        }
      });

      if (!meshCount || !skinnedMeshCount) {
        throw new Error("Este archivo todavía no contiene una prenda con skinning real.");
      }

      garmentRoot.position.set(0, 0, 0);
      garmentRoot.rotation.set(0, 0, 0);
      garmentRoot.scale.set(1, 1, 1);
      garmentRoot.name = "CLOUVA_REAL_RIGGED_GARMENT";

      const garmentBones = collectBones(garmentRoot);
      const avatarBones = avatarBonesRef.current;
      const pairs: BonePair[] = [];
      for (const [name, target] of garmentBones) {
        const source = avatarBones.get(name);
        if (source) pairs.push({ source, target });
      }

      if (pairs.length < 6) {
        throw new Error(`El rig de la prenda no coincide con el avatar (${pairs.length} huesos compatibles).`);
      }

      avatarRootRef.current.add(garmentRoot);
      garmentRootRef.current = garmentRoot;
      bonePairsRef.current = pairs;
      statusRef.current?.(`✓ Prenda riggeada real cargada: ${pairs.length} huesos sincronizados con el avatar.`);
    }).catch((cause) => {
      if (cancelled) return;
      disposeObject(garmentRootRef.current);
      garmentRootRef.current = null;
      bonePairsRef.current = [];
      statusRef.current?.(
        cause instanceof Error
          ? `No se pudo montar la prenda riggeada: ${cause.message}`
          : "No se pudo montar la prenda riggeada sobre el avatar.",
      );
    });

    return () => {
      cancelled = true;
      disposeObject(garmentRootRef.current);
      garmentRootRef.current = null;
      bonePairsRef.current = [];
    };
  }, [modelUrl, avatarRevision]);

  useEffect(() => {
    const sync = () => {
      for (const { source, target } of bonePairsRef.current) {
        target.position.copy(source.position);
        target.quaternion.copy(source.quaternion);
        target.scale.copy(source.scale);
      }
      garmentRootRef.current?.updateMatrixWorld(true);
      frameRef.current = window.requestAnimationFrame(sync);
    };
    frameRef.current = window.requestAnimationFrame(sync);
    return () => window.cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => () => disposeObject(garmentRootRef.current), []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 500 }}>
      <CreatorStudioAvatarViewer
        modelUrl={avatar.modelUrl}
        fallbackModelUrl={avatar.fallbackUrl}
        frontRotationY={avatar.frontRotationY}
        viewRotationY={viewRotationY}
        config={defaultAvatarConfig}
        poseMode={poseMode}
        className="h-full min-h-[500px] w-full"
        onReady={attachAvatar}
      />
    </div>
  );
}
