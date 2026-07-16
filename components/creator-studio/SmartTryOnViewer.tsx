"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Bone,
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
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

type Rig = {
  root: Object3D;
  hips?: Bone;
  chest?: Bone;
  neck?: Bone;
  head?: Bone;
  leftUpperArm?: Bone;
  rightUpperArm?: Bone;
  leftUpperLeg?: Bone;
  rightUpperLeg?: Bone;
  leftFoot?: Bone;
  rightFoot?: Bone;
};

function cleanName(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function findBone(root: Object3D, aliases: string[]) {
  let exact: Bone | undefined;
  let partial: Bone | undefined;
  root.traverse((object) => {
    const bone = object as Bone;
    if (!bone.isBone) return;
    const name = cleanName(bone.name);
    if (!exact && aliases.includes(name)) exact = bone;
    if (!partial && aliases.some((alias) => name.includes(alias) || alias.includes(name))) partial = bone;
  });
  return exact ?? partial;
}

function resolveRig(root: Object3D): Rig {
  return {
    root,
    hips: findBone(root, ["hips", "pelvis", "jbiphips", "jbipchips"]),
    chest: findBone(root, ["chest", "upperchest", "spine2", "spine02", "jbipchest", "jbipupperchest"]),
    neck: findBone(root, ["neck", "jbipneck"]),
    head: findBone(root, ["head", "jbiphead"]),
    leftUpperArm: findBone(root, ["leftarm", "upperarml", "upperarmleft", "jbiplupperarm"]),
    rightUpperArm: findBone(root, ["rightarm", "upperarmr", "upperarmright", "jbiprupperarm"]),
    leftUpperLeg: findBone(root, ["leftupleg", "thighl", "upperlegl", "jbiplupperleg"]),
    rightUpperLeg: findBone(root, ["rightupleg", "thighr", "upperlegr", "jbiprupperleg"]),
    leftFoot: findBone(root, ["leftfoot", "footl", "jbiplfoot"]),
    rightFoot: findBone(root, ["rightfoot", "footr", "jbiprfoot"]),
  };
}

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

function addPiece(
  parent: Object3D,
  name: string,
  geometry: any,
  material: MeshPhysicalMaterial,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rotation: [number, number, number] = [0, 0, 0],
) {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.userData.clouvaTryOn = true;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function clearPreview(root: Object3D | null) {
  if (!root) return;
  const pieces: Object3D[] = [];
  root.traverse((object: any) => {
    if (!object.userData?.clouvaTryOn) return;
    pieces.push(object);
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
    else object.material?.dispose?.();
  });
  pieces.forEach((piece) => piece.removeFromParent());
}

function buildPreview(rig: Rig, category: string, texture: Texture | null, adjustments: TryOnAdjustments, fit: Props["fit"]) {
  clearPreview(rig.root);
  const material = makeMaterial(texture);
  const fitScale = fit === "Slim" ? 0.92 : fit === "Oversize" ? 1.12 : 1;
  const scale = adjustments.scale / 100;
  const width = adjustments.width / 100;
  const length = adjustments.length / 100;
  const offsetX = adjustments.x / 100;
  const offsetY = (adjustments.y + adjustments.height) / 100;
  const offsetZ = adjustments.distance / 250;

  const chest = rig.chest ?? rig.root;
  const hips = rig.hips ?? rig.root;
  const head = rig.head ?? rig.neck ?? rig.root;

  if (["hoodie", "campera", "remera"].includes(category)) {
    addPiece(chest, "tryon-torso", new CapsuleGeometry(0.22, 0.36, 8, 18), material,
      [offsetX, -0.12 + offsetY, 0.03 + offsetZ],
      [1.3 * width * fitScale * scale, length * scale, 0.74 * fitScale * scale],
      [0, adjustments.rotation * Math.PI / 180, 0]);

    const sleeveScale = adjustments.sleeveLength / 100;
    addPiece(rig.leftUpperArm ?? chest, "tryon-left-sleeve", new CapsuleGeometry(0.085, 0.32, 6, 12), material,
      [0, -0.18, 0], [0.86 * fitScale * scale, sleeveScale * scale, 0.86 * fitScale * scale]);
    addPiece(rig.rightUpperArm ?? chest, "tryon-right-sleeve", new CapsuleGeometry(0.085, 0.32, 6, 12), material,
      [0, -0.18, 0], [0.86 * fitScale * scale, sleeveScale * scale, 0.86 * fitScale * scale]);

    if (category === "hoodie") {
      const hoodScale = adjustments.hoodSize / 50;
      addPiece(head, "tryon-hood", new SphereGeometry(0.22, 20, 16), material,
        [0, -0.18, -0.08], [hoodScale * scale, hoodScale * scale, 0.82 * hoodScale * scale]);
    }
  } else if (category === "baggy") {
    addPiece(hips, "tryon-waist", new CylinderGeometry(0.28, 0.32, 0.2, 24), material,
      [offsetX, -0.06 + offsetY, offsetZ], [width * fitScale * scale, scale, fitScale * scale]);
    const legScale = adjustments.legLength / 100;
    addPiece(rig.leftUpperLeg ?? hips, "tryon-left-leg", new CapsuleGeometry(0.14, 0.5, 8, 16), material,
      [0, -0.28, 0], [1.15 * fitScale * scale, legScale * scale, 1.06 * fitScale * scale]);
    addPiece(rig.rightUpperLeg ?? hips, "tryon-right-leg", new CapsuleGeometry(0.14, 0.5, 8, 16), material,
      [0, -0.28, 0], [1.15 * fitScale * scale, legScale * scale, 1.06 * fitScale * scale]);
  } else if (category === "zapatillas") {
    addPiece(rig.leftFoot ?? hips, "tryon-left-shoe", new BoxGeometry(0.22, 0.11, 0.38), material, [0, -0.04, 0.12], [scale, scale, scale]);
    addPiece(rig.rightFoot ?? hips, "tryon-right-shoe", new BoxGeometry(0.22, 0.11, 0.38), material, [0, -0.04, 0.12], [scale, scale, scale]);
  } else if (category === "gorra") {
    addPiece(head, "tryon-cap", new SphereGeometry(0.22, 24, 14), material, [0, 0.14, 0], [1.12 * scale, 0.72 * scale, 1.08 * scale]);
    addPiece(head, "tryon-visor", new BoxGeometry(0.32, 0.035, 0.14), material, [0, 0.08, 0.17], [scale, scale, scale]);
  } else if (category === "cadena") {
    addPiece(rig.neck ?? chest, "tryon-chain", new TorusGeometry(0.18, 0.018, 10, 40), material, [0, -0.1, 0.08], [scale, 1.25 * scale, 0.7 * scale], [Math.PI / 2, 0, 0]);
  } else if (category === "lentes") {
    addPiece(head, "tryon-left-lens", new TorusGeometry(0.09, 0.012, 8, 24), material, [-0.1, 0, 0.18], [scale, scale, scale]);
    addPiece(head, "tryon-right-lens", new TorusGeometry(0.09, 0.012, 8, 24), material, [0.1, 0, 0.18], [scale, scale, scale]);
  } else if (category === "mochila") {
    addPiece(chest, "tryon-backpack", new CapsuleGeometry(0.22, 0.4, 8, 18), material, [0, -0.1, -0.24], [1.05 * scale, scale, 0.62 * scale]);
  } else {
    addPiece(chest, "tryon-accessory", new SphereGeometry(0.08, 16, 12), material, [0, 0, 0.16], [scale, scale, scale]);
  }
}

export function SmartTryOnViewer({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl }: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarRootRef = useRef<Object3D | null>(null);
  const rigRef = useRef<Rig | null>(null);
  const textureRef = useRef<Texture | null>(null);

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const frontRotationY = avatar.frontRotationY + viewRotation;
  const poseMode: AvatarPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  const rebuild = useCallback((root?: Object3D) => {
    const avatarRoot = root ?? avatarRootRef.current;
    if (!avatarRoot) return;
    avatarRootRef.current = avatarRoot;
    const rig = resolveRig(avatarRoot);
    rigRef.current = rig;
    buildPreview(rig, category, textureRef.current, adjustments, fit);
  }, [category, adjustments, fit]);

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    if (!imageUrl) {
      rebuild();
      return;
    }
    new TextureLoader().load(imageUrl, (texture) => {
      texture.colorSpace = "srgb" as any;
      textureRef.current = texture;
      rebuild();
    }, undefined, () => rebuild());
  }, [imageUrl, rebuild]);

  useEffect(() => {
    const root = avatarRootRef.current;
    if (!root) return;
    root.traverse((object: any) => {
      if (!object.isMesh && !object.isSkinnedMesh) return;
      if (object.userData?.clouvaTryOn) object.visible = true;
      else object.visible = showBody && !garmentOnly;
    });
  }, [showBody, garmentOnly, category, adjustments]);

  useEffect(() => () => {
    clearPreview(avatarRootRef.current);
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
        alt="Vista previa 3D con ropa anclada al rig CLOUVA"
        onReady={rebuild}
      />
    </div>
  );
}
