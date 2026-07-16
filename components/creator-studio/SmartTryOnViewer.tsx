"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  SphereGeometry,
  Texture,
  TextureLoader,
  TorusGeometry,
} from "three";
import { AvatarModelViewer, type AvatarPoseMode } from "@/components/avatar-engine/AvatarModelViewer";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";

export type TryOnAdjustments = {
  scale: number;
  length: number;
  width: number;
  x: number;
  y: number;
  rotation: number;
  height: number;
  distance: number;
  sleeveLength: number;
  legLength: number;
  waistHeight: number;
  neckSize: number;
  hoodSize: number;
};

type Props = {
  category: string;
  fit: "Slim" | "Regular" | "Oversize";
  pose: "T-Pose" | "Idle" | "Walk";
  view: "Frente" | "Lateral" | "Espalda";
  background: string;
  showBody: boolean;
  garmentOnly: boolean;
  adjustments: TryOnAdjustments;
  imageUrl?: string | null;
};

function makeMaterial(texture: Texture | null) {
  return new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x7448c8,
    map: texture,
    roughness: 0.72,
    metalness: 0.03,
    clearcoat: 0.08,
    side: DoubleSide,
    transparent: true,
    opacity: 0.94,
  });
}

function add(group: Group, name: string, geometry: any, material: MeshPhysicalMaterial, position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotation: [number, number, number] = [0, 0, 0]) {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function createPreview(category: string, texture: Texture | null) {
  const group = new Group();
  group.name = "clouva-smart-try-on-preview";
  const material = makeMaterial(texture);
  const h = 2.05;

  if (["hoodie", "campera", "remera"].includes(category)) {
    add(group, "torso", new CapsuleGeometry(h * 0.11, h * 0.18, 8, 18), material, [0, h * 0.55, h * 0.02], [1.35, 1, 0.72]);
    add(group, "leftSleeve", new CapsuleGeometry(h * 0.045, h * 0.16, 6, 12), material, [-h * 0.145, h * 0.55, 0], [0.8, 1, 0.8]);
    add(group, "rightSleeve", new CapsuleGeometry(h * 0.045, h * 0.16, 6, 12), material, [h * 0.145, h * 0.55, 0], [0.8, 1, 0.8]);
    if (category === "hoodie") add(group, "hood", new SphereGeometry(h * 0.105, 20, 16), material, [0, h * 0.75, -h * 0.05], [1, 1.05, 0.78]);
  } else if (category === "baggy") {
    add(group, "waist", new CylinderGeometry(h * 0.145, h * 0.17, h * 0.12, 24), material, [0, h * 0.42, 0]);
    add(group, "leftLeg", new CapsuleGeometry(h * 0.072, h * 0.25, 8, 16), material, [-h * 0.075, h * 0.255, 0], [1.18, 1, 1.05]);
    add(group, "rightLeg", new CapsuleGeometry(h * 0.072, h * 0.25, 8, 16), material, [h * 0.075, h * 0.255, 0], [1.18, 1, 1.05]);
  } else if (category === "zapatillas") {
    add(group, "leftShoe", new BoxGeometry(h * 0.12, h * 0.06, h * 0.22), material, [-h * 0.07, h * 0.035, h * 0.05]);
    add(group, "rightShoe", new BoxGeometry(h * 0.12, h * 0.06, h * 0.22), material, [h * 0.07, h * 0.035, h * 0.05]);
  } else if (category === "gorra") {
    add(group, "cap", new SphereGeometry(h * 0.105, 24, 14), material, [0, h * 0.86, 0], [1.12, 0.72, 1.08]);
    add(group, "visor", new BoxGeometry(h * 0.16, h * 0.018, h * 0.07), material, [0, h * 0.82, h * 0.085]);
  } else if (category === "cadena") {
    add(group, "chain", new TorusGeometry(h * 0.09, h * 0.009, 10, 40), material, [0, h * 0.69, h * 0.055], [1, 1.25, 0.7], [Math.PI / 2, 0, 0]);
  } else if (category === "lentes") {
    add(group, "leftLens", new TorusGeometry(h * 0.045, h * 0.006, 8, 24), material, [-h * 0.05, h * 0.8, h * 0.09]);
    add(group, "rightLens", new TorusGeometry(h * 0.045, h * 0.006, 8, 24), material, [h * 0.05, h * 0.8, h * 0.09]);
  } else if (category === "mochila") {
    add(group, "backpack", new CapsuleGeometry(h * 0.11, h * 0.2, 8, 18), material, [0, h * 0.55, -h * 0.12], [1.05, 1, 0.62]);
  } else {
    add(group, "accessory", new SphereGeometry(h * 0.04, 16, 12), material, [0, h * 0.5, 0]);
  }

  return group;
}

function applyPreviewPose(preview: Group, category: string, pose: Props["pose"], sleeveLength: number) {
  if (!["hoodie", "campera", "remera"].includes(category)) return;
  const h = 2.05;
  const left = preview.getObjectByName("leftSleeve");
  const right = preview.getObjectByName("rightSleeve");
  if (!left || !right) return;

  left.scale.y = sleeveLength / 100;
  right.scale.y = sleeveLength / 100;

  if (pose === "T-Pose") {
    left.position.set(-h * 0.25, h * 0.61, 0);
    right.position.set(h * 0.25, h * 0.61, 0);
    left.rotation.set(0, 0, Math.PI / 2);
    right.rotation.set(0, 0, -Math.PI / 2);
  } else if (pose === "Walk") {
    left.position.set(-h * 0.15, h * 0.55, h * 0.015);
    right.position.set(h * 0.15, h * 0.55, -h * 0.015);
    left.rotation.set(0.22, 0, 0.11);
    right.rotation.set(-0.22, 0, -0.11);
  } else {
    left.position.set(-h * 0.15, h * 0.55, 0);
    right.position.set(h * 0.15, h * 0.55, 0);
    left.rotation.set(0, 0, 0.1);
    right.rotation.set(0, 0, -0.1);
  }
}

function disposeGroup(group: Group | null) {
  if (!group) return;
  group.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
    else object.material?.dispose?.();
  });
  group.removeFromParent();
}

export function SmartTryOnViewer({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl }: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarObjectRef = useRef<Object3D | null>(null);
  const previewRef = useRef<Group | null>(null);
  const textureRef = useRef<Texture | null>(null);

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const frontRotationY = avatar.frontRotationY + viewRotation;
  const poseMode: AvatarPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  const rebuildPreview = useCallback((root: Object3D) => {
    avatarObjectRef.current = root;
    disposeGroup(previewRef.current);
    const preview = createPreview(category, textureRef.current);
    applyPreviewPose(preview, category, pose, adjustments.sleeveLength);
    preview.rotation.y = frontRotationY + (adjustments.rotation * Math.PI) / 180;
    previewRef.current = preview;
    (root.parent ?? root).add(preview);
  }, [category, pose, adjustments.sleeveLength, adjustments.rotation, frontRotationY]);

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    const rebuild = () => {
      const root = avatarObjectRef.current;
      if (root) rebuildPreview(root);
    };
    if (!imageUrl) {
      rebuild();
      return;
    }
    const loader = new TextureLoader();
    loader.load(imageUrl, (texture) => {
      texture.colorSpace = "srgb" as any;
      textureRef.current = texture;
      rebuild();
    }, undefined, rebuild);
  }, [imageUrl, rebuildPreview]);

  useEffect(() => {
    const root = avatarObjectRef.current;
    const preview = previewRef.current;
    if (!preview) return;

    if (root) {
      root.traverse((object) => {
        if ((object as Mesh).isMesh) object.visible = showBody && !garmentOnly;
      });
    }

    const fitScale = fit === "Slim" ? 0.92 : fit === "Oversize" ? 1.12 : 1;
    preview.position.set(adjustments.x / 100, (adjustments.y + adjustments.height) / 100, adjustments.distance / 250);
    preview.rotation.y = frontRotationY + (adjustments.rotation * Math.PI) / 180;
    preview.scale.set(
      (adjustments.width / 100) * (adjustments.scale / 100) * fitScale,
      (adjustments.length / 100) * (adjustments.scale / 100),
      (1 + adjustments.distance / 100) * (adjustments.scale / 100) * fitScale,
    );
    applyPreviewPose(preview, category, pose, adjustments.sleeveLength);
  }, [adjustments, fit, showBody, garmentOnly, category, pose, frontRotationY]);

  useEffect(() => () => {
    disposeGroup(previewRef.current);
    textureRef.current?.dispose();
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 500, background }}>
      <AvatarModelViewer
        modelUrl={avatar.modelUrl}
        fallbackModelUrl={avatar.fallbackUrl}
        frontRotationY={frontRotationY}
        config={defaultAvatarConfig}
        playAnimations={false}
        motionTest={false}
        poseMode={poseMode}
        className="h-full min-h-[500px] w-full"
        alt="Vista previa 3D sobre el avatar CLOUVA"
        onReady={rebuildPreview}
      />
    </div>
  );
}
