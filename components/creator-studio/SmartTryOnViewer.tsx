"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Bone,
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Texture,
  TextureLoader,
  TorusGeometry,
} from "three";
import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
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

type Pose = "T-Pose" | "Idle" | "Walk";
type Props = {
  category: string;
  fit: "Slim" | "Regular" | "Oversize";
  pose: Pose;
  view: "Frente" | "Lateral" | "Espalda";
  background: string;
  showBody: boolean;
  garmentOnly: boolean;
  adjustments: TryOnAdjustments;
  imageUrl?: string | null;
};

type PoseBone = { bone: Bone; base: Quaternion };
type PoseRig = {
  leftShoulder?: PoseBone;
  rightShoulder?: PoseBone;
  leftArm?: PoseBone;
  rightArm?: PoseBone;
  leftForeArm?: PoseBone;
  rightForeArm?: PoseBone;
  leftUpLeg?: PoseBone;
  rightUpLeg?: PoseBone;
  leftLeg?: PoseBone;
  rightLeg?: PoseBone;
  hips?: PoseBone;
};

function cleanName(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function findBone(bones: Bone[], aliases: string[]): Bone | undefined {
  return bones.find((bone) => aliases.includes(cleanName(bone.name)))
    ?? bones.find((bone) => aliases.some((alias) => cleanName(bone.name).includes(alias)));
}

function collectPoseRig(root: Object3D): PoseRig {
  const bones: Bone[] = [];
  root.traverse((object) => {
    const bone = object as Bone;
    if (bone.isBone) bones.push(bone);
  });
  const entry = (aliases: string[]): PoseBone | undefined => {
    const bone = findBone(bones, aliases);
    return bone ? { bone, base: bone.quaternion.clone() } : undefined;
  };
  return {
    hips: entry(["hips", "pelvis"]),
    leftShoulder: entry(["leftshoulder", "shoulderl", "claviclel", "leftclavicle"]),
    rightShoulder: entry(["rightshoulder", "shoulderr", "clavicler", "rightclavicle"]),
    leftArm: entry(["leftarm", "upperarml", "upperarmleft"]),
    rightArm: entry(["rightarm", "upperarmr", "upperarmright"]),
    leftForeArm: entry(["leftforearm", "forearml", "lowerarml"]),
    rightForeArm: entry(["rightforearm", "forearmr", "lowerarmr"]),
    leftUpLeg: entry(["leftupleg", "thighl", "upperlegl"]),
    rightUpLeg: entry(["rightupleg", "thighr", "upperlegr"]),
    leftLeg: entry(["leftleg", "calfl", "lowerlegl", "shinl"]),
    rightLeg: entry(["rightleg", "calfr", "lowerlegr", "shinr"]),
  };
}

const poseEuler = new Euler();
const poseQuaternion = new Quaternion();
function setBone(entry: PoseBone | undefined, x: number, y: number, z: number) {
  if (!entry) return;
  poseEuler.set(x, y, z, "XYZ");
  poseQuaternion.setFromEuler(poseEuler);
  entry.bone.quaternion.copy(entry.base).multiply(poseQuaternion);
}

function applyAvatarPose(rig: PoseRig, pose: Pose, elapsed: number) {
  if (pose === "T-Pose") {
    setBone(rig.hips, 0, 0, 0);
    setBone(rig.leftShoulder, 0, 0, 0.08);
    setBone(rig.rightShoulder, 0, 0, -0.08);
    setBone(rig.leftArm, 0, 0, 1.35);
    setBone(rig.rightArm, 0, 0, -1.35);
    setBone(rig.leftForeArm, 0, 0, 0);
    setBone(rig.rightForeArm, 0, 0, 0);
    setBone(rig.leftUpLeg, 0, 0, 0);
    setBone(rig.rightUpLeg, 0, 0, 0);
    return;
  }

  if (pose === "Walk") {
    const step = Math.sin(elapsed * 4.5);
    setBone(rig.hips, 0, step * 0.035, 0);
    setBone(rig.leftArm, -step * 0.22, 0, 0.12);
    setBone(rig.rightArm, step * 0.22, 0, -0.12);
    setBone(rig.leftForeArm, 0, 0, 0.08);
    setBone(rig.rightForeArm, 0, 0, -0.08);
    setBone(rig.leftUpLeg, step * 0.24, 0, 0);
    setBone(rig.rightUpLeg, -step * 0.24, 0, 0);
    setBone(rig.leftLeg, Math.max(0, -step) * 0.22, 0, 0);
    setBone(rig.rightLeg, Math.max(0, step) * 0.22, 0, 0);
    return;
  }

  const breath = Math.sin(elapsed * 1.5);
  setBone(rig.hips, 0, 0, 0);
  setBone(rig.leftShoulder, 0, 0, 0.05);
  setBone(rig.rightShoulder, 0, 0, -0.05);
  setBone(rig.leftArm, -0.03 + breath * 0.006, 0, 0.12);
  setBone(rig.rightArm, -0.03 - breath * 0.006, 0, -0.12);
  setBone(rig.leftForeArm, 0, 0, 0.04);
  setBone(rig.rightForeArm, 0, 0, -0.04);
  setBone(rig.leftUpLeg, 0, 0, 0);
  setBone(rig.rightUpLeg, 0, 0, 0);
  setBone(rig.leftLeg, 0, 0, 0);
  setBone(rig.rightLeg, 0, 0, 0);
}

function makeMaterial(texture: Texture | null) {
  return new MeshPhysicalMaterial({ color: texture ? 0xffffff : 0x7448c8, map: texture, roughness: 0.72, metalness: 0.03, clearcoat: 0.08, side: DoubleSide, transparent: true, opacity: 0.94 });
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

function applyPreviewPose(preview: Group, category: string, pose: Pose, sleeveLength: number) {
  if (!["hoodie", "campera", "remera"].includes(category)) return;
  const h = 2.05;
  const left = preview.getObjectByName("leftSleeve");
  const right = preview.getObjectByName("rightSleeve");
  if (!left || !right) return;
  const sleeveScale = sleeveLength / 100;
  left.scale.y = sleeveScale;
  right.scale.y = sleeveScale;
  if (pose === "T-Pose") {
    left.position.set(-h * 0.25, h * 0.61, 0);
    right.position.set(h * 0.25, h * 0.61, 0);
    left.rotation.z = Math.PI / 2;
    right.rotation.z = -Math.PI / 2;
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
  const poseRigRef = useRef<PoseRig>({});
  const poseRef = useRef<Pose>(pose);
  const previewRef = useRef<Group | null>(null);
  const textureRef = useRef<Texture | null>(null);
  poseRef.current = pose;

  const frontRotationY = useMemo(() => {
    const viewRotation = view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI;
    return avatar.frontRotationY + viewRotation;
  }, [avatar.frontRotationY, view]);

  useEffect(() => {
    let frame = 0;
    const started = performance.now();
    const animatePose = (now: number) => {
      applyAvatarPose(poseRigRef.current, poseRef.current, (now - started) / 1000);
      frame = requestAnimationFrame(animatePose);
    };
    frame = requestAnimationFrame(animatePose);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    const rebuild = () => {
      const root = avatarObjectRef.current;
      if (!root) return;
      disposeGroup(previewRef.current);
      previewRef.current = createPreview(category, textureRef.current);
      applyPreviewPose(previewRef.current, category, pose, adjustments.sleeveLength);
      root.add(previewRef.current);
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
  }, [category, imageUrl, pose, adjustments.sleeveLength]);

  useEffect(() => {
    const root = avatarObjectRef.current;
    const preview = previewRef.current;
    if (!preview) return;
    if (root) {
      root.traverse((object) => {
        if ((object as Mesh).isMesh && !preview.getObjectById(object.id)) object.visible = showBody && !garmentOnly;
      });
    }
    const fitScale = fit === "Slim" ? 0.92 : fit === "Oversize" ? 1.12 : 1;
    preview.position.set(adjustments.x / 100, (adjustments.y + adjustments.height) / 100, adjustments.distance / 250);
    preview.rotation.y = (adjustments.rotation * Math.PI) / 180;
    preview.scale.set((adjustments.width / 100) * (adjustments.scale / 100) * fitScale, (adjustments.length / 100) * (adjustments.scale / 100), (1 + adjustments.distance / 100) * (adjustments.scale / 100) * fitScale);
    applyPreviewPose(preview, category, pose, adjustments.sleeveLength);
  }, [adjustments, fit, showBody, garmentOnly, category, pose]);

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
        className="h-full min-h-[500px] w-full"
        alt="Vista previa 3D sobre el avatar CLOUVA"
        onReady={(object) => {
          avatarObjectRef.current = object;
          poseRigRef.current = collectPoseRig(object);
          disposeGroup(previewRef.current);
          previewRef.current = createPreview(category, textureRef.current);
          applyPreviewPose(previewRef.current, category, poseRef.current, adjustments.sleeveLength);
          object.add(previewRef.current);
        }}
      />
    </div>
  );
}
