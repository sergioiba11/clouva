"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Bone,
  Box3,
  BoxGeometry,
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
  Vector3,
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

type RigKey =
  | "hips" | "chest" | "neck" | "head"
  | "leftShoulder" | "rightShoulder"
  | "leftUpperArm" | "rightUpperArm"
  | "leftLowerArm" | "rightLowerArm"
  | "leftHand" | "rightHand"
  | "leftUpperLeg" | "rightUpperLeg"
  | "leftLowerLeg" | "rightLowerLeg";

type RigEntry = { bone: Bone; base: Quaternion };
type Rig = Partial<Record<RigKey, RigEntry>>;

type GarmentParts = {
  root: Group;
  torso?: Mesh;
  hood?: Mesh;
  leftUpperSleeve?: Mesh;
  rightUpperSleeve?: Mesh;
  leftLowerSleeve?: Mesh;
  rightLowerSleeve?: Mesh;
  leftLeg?: Mesh;
  rightLeg?: Mesh;
};

const aliases: Record<RigKey, string[]> = {
  hips: ["hips", "pelvis", "jbiphips", "root"],
  chest: ["upperchest", "chest", "spine2", "spine02", "jbipupperchest", "jbipchest"],
  neck: ["neck", "jbipneck"],
  head: ["head", "jbiphead"],
  leftShoulder: ["leftshoulder", "lshoulder", "shoulderl", "claviclel", "jbiplshoulder"],
  rightShoulder: ["rightshoulder", "rshoulder", "shoulderr", "clavicler", "jbiprshoulder"],
  leftUpperArm: ["leftupperarm", "upperarml", "lupperarm", "leftarm", "jbiplupperarm"],
  rightUpperArm: ["rightupperarm", "upperarmr", "rupperarm", "rightarm", "jbiprupperarm"],
  leftLowerArm: ["leftlowerarm", "lowerarml", "lforearm", "leftforearm", "jbipllowerarm"],
  rightLowerArm: ["rightlowerarm", "lowerarmr", "rforearm", "rightforearm", "jbiprlowerarm"],
  leftHand: ["lefthand", "handl", "lhand", "jbiplhand"],
  rightHand: ["righthand", "handr", "rhand", "jbiprhand"],
  leftUpperLeg: ["leftupperleg", "upperlegl", "thighl", "jbiplupperleg"],
  rightUpperLeg: ["rightupperleg", "upperlegr", "thighr", "jbiprupperleg"],
  leftLowerLeg: ["leftlowerleg", "lowerlegl", "calfl", "jbipllowerleg"],
  rightLowerLeg: ["rightlowerleg", "lowerlegr", "calfr", "jbiprlowerleg"],
};

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpMid = new Vector3();
const tmpDir = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();

function clean(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function collectRig(root: Object3D): Rig {
  const bones: Bone[] = [];
  root.traverse((object) => {
    const bone = object as Bone;
    if (bone.isBone) bones.push(bone);
  });

  const rig: Rig = {};
  for (const key of Object.keys(aliases) as RigKey[]) {
    const names = aliases[key];
    const found = bones.find((bone) => names.includes(clean(bone.name)))
      ?? bones.find((bone) => names.some((name) => clean(bone.name).includes(name)));
    if (found) rig[key] = { bone: found, base: found.quaternion.clone() };
  }
  return rig;
}

function material(texture: Texture | null) {
  return new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x7d4bd1,
    map: texture,
    roughness: 0.72,
    metalness: 0.02,
    clearcoat: 0.08,
    side: DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
}

function mesh(name: string, geometry: BoxGeometry | CylinderGeometry | SphereGeometry | TorusGeometry, mat: MeshPhysicalMaterial) {
  const item = new Mesh(geometry, mat);
  item.name = name;
  item.castShadow = true;
  item.frustumCulled = false;
  return item;
}

function createGarment(category: string, texture: Texture | null): GarmentParts {
  const root = new Group();
  root.name = "clouva-rigged-preview";
  const mat = material(texture);
  const parts: GarmentParts = { root };

  if (["hoodie", "campera", "remera"].includes(category)) {
    parts.torso = mesh("torso", new SphereGeometry(1, 28, 20), mat);
    parts.leftUpperSleeve = mesh("leftUpperSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    parts.rightUpperSleeve = mesh("rightUpperSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    parts.leftLowerSleeve = mesh("leftLowerSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    parts.rightLowerSleeve = mesh("rightLowerSleeve", new CylinderGeometry(1, 1, 1, 18), mat);
    root.add(parts.torso, parts.leftUpperSleeve, parts.rightUpperSleeve, parts.leftLowerSleeve, parts.rightLowerSleeve);
    if (category === "hoodie") {
      parts.hood = mesh("hood", new SphereGeometry(1, 24, 18), mat);
      root.add(parts.hood);
    }
  } else if (category === "baggy") {
    parts.torso = mesh("waist", new CylinderGeometry(1, 1.12, 1, 22), mat);
    parts.leftLeg = mesh("leftLeg", new CylinderGeometry(1, 1.12, 1, 18), mat);
    parts.rightLeg = mesh("rightLeg", new CylinderGeometry(1, 1.12, 1, 18), mat);
    root.add(parts.torso, parts.leftLeg, parts.rightLeg);
  } else if (category === "zapatillas") {
    parts.leftLeg = mesh("leftShoe", new BoxGeometry(1, 1, 1.6), mat);
    parts.rightLeg = mesh("rightShoe", new BoxGeometry(1, 1, 1.6), mat);
    root.add(parts.leftLeg, parts.rightLeg);
  } else if (category === "gorra") {
    parts.hood = mesh("cap", new SphereGeometry(1, 24, 16), mat);
    root.add(parts.hood);
  } else if (category === "cadena") {
    parts.torso = mesh("chain", new TorusGeometry(1, 0.1, 10, 42), mat);
    root.add(parts.torso);
  } else if (category === "lentes") {
    parts.torso = mesh("glasses", new TorusGeometry(1, 0.1, 10, 42), mat);
    root.add(parts.torso);
  } else if (category === "mochila") {
    parts.torso = mesh("backpack", new SphereGeometry(1, 24, 18), mat);
    root.add(parts.torso);
  }
  return parts;
}

function poseBone(entry: RigEntry | undefined, x: number, y: number, z: number) {
  if (!entry) return;
  tmpEuler.set(x, y, z, "XYZ");
  tmpQuat.setFromEuler(tmpEuler);
  entry.bone.quaternion.copy(entry.base).multiply(tmpQuat);
}

function applyAvatarPose(rig: Rig, pose: Pose, elapsed: number) {
  const step = Math.sin(elapsed * 4.2);
  const breath = Math.sin(elapsed * 1.5);

  if (pose === "T-Pose") {
    poseBone(rig.leftShoulder, 0, 0, 0.04);
    poseBone(rig.rightShoulder, 0, 0, -0.04);
    poseBone(rig.leftUpperArm, 0, 0, Math.PI / 2 - 0.05);
    poseBone(rig.rightUpperArm, 0, 0, -Math.PI / 2 + 0.05);
    poseBone(rig.leftLowerArm, 0, 0, 0);
    poseBone(rig.rightLowerArm, 0, 0, 0);
    poseBone(rig.leftUpperLeg, 0, 0, 0);
    poseBone(rig.rightUpperLeg, 0, 0, 0);
    return;
  }

  if (pose === "Walk") {
    poseBone(rig.leftUpperArm, -step * 0.32, 0, 0.12);
    poseBone(rig.rightUpperArm, step * 0.32, 0, -0.12);
    poseBone(rig.leftLowerArm, 0, 0, 0.1);
    poseBone(rig.rightLowerArm, 0, 0, -0.1);
    poseBone(rig.leftUpperLeg, step * 0.28, 0, 0);
    poseBone(rig.rightUpperLeg, -step * 0.28, 0, 0);
    poseBone(rig.leftLowerLeg, Math.max(0, -step) * 0.2, 0, 0);
    poseBone(rig.rightLowerLeg, Math.max(0, step) * 0.2, 0, 0);
    poseBone(rig.chest, -step * 0.025, 0, 0);
    return;
  }

  poseBone(rig.leftUpperArm, -0.02, 0, 0.1);
  poseBone(rig.rightUpperArm, -0.02, 0, -0.1);
  poseBone(rig.leftLowerArm, 0, 0, 0.04);
  poseBone(rig.rightLowerArm, 0, 0, -0.04);
  poseBone(rig.leftUpperLeg, 0, 0, 0);
  poseBone(rig.rightUpperLeg, 0, 0, 0);
  poseBone(rig.chest, breath * 0.012, 0, 0);
  poseBone(rig.head, breath * 0.006, 0, 0);
}

function placeBetween(item: Mesh | undefined, start: Object3D | undefined, end: Object3D | undefined, radius: number, lengthMultiplier = 1) {
  if (!item || !start || !end) return;
  start.getWorldPosition(tmpA);
  end.getWorldPosition(tmpB);
  tmpMid.copy(tmpA).add(tmpB).multiplyScalar(0.5);
  tmpDir.copy(tmpB).sub(tmpA);
  const length = Math.max(tmpDir.length() * lengthMultiplier, 0.01);
  tmpDir.normalize();
  item.position.copy(tmpMid);
  item.quaternion.setFromUnitVectors(yAxis, tmpDir);
  item.scale.set(radius, length, radius);
}

function dispose(parts: GarmentParts | null) {
  if (!parts) return;
  parts.root.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((value: any) => value.dispose?.());
    else object.material?.dispose?.();
  });
  parts.root.removeFromParent();
}

export function SmartTryOnViewer({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl }: Props) {
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const avatarRef = useRef<Object3D | null>(null);
  const rigRef = useRef<Rig>({});
  const garmentRef = useRef<GarmentParts | null>(null);
  const textureRef = useRef<Texture | null>(null);
  const frameRef = useRef(0);
  const propsRef = useRef({ category, fit, pose, showBody, garmentOnly, adjustments });
  propsRef.current = { category, fit, pose, showBody, garmentOnly, adjustments };

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const frontRotationY = avatar.frontRotationY + viewRotation;
  const poseMode: AvatarPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  const rebuild = (root: Object3D) => {
    avatarRef.current = root;
    rigRef.current = collectRig(root);
    dispose(garmentRef.current);
    const garment = createGarment(category, textureRef.current);
    garmentRef.current = garment;
    (root.parent ?? root).add(garment.root);
  };

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    if (!imageUrl) {
      if (avatarRef.current) rebuild(avatarRef.current);
      return;
    }
    new TextureLoader().load(imageUrl, (texture) => {
      texture.colorSpace = "srgb" as any;
      textureRef.current = texture;
      if (avatarRef.current) rebuild(avatarRef.current);
    });
  }, [imageUrl, category]);

  useEffect(() => {
    const started = performance.now();
    const update = () => {
      const avatarRoot = avatarRef.current;
      const garment = garmentRef.current;
      if (avatarRoot && garment) {
        const current = propsRef.current;
        const rig = rigRef.current;
        const elapsed = (performance.now() - started) / 1000;
        applyAvatarPose(rig, current.pose, elapsed);
        avatarRoot.updateMatrixWorld(true);

        avatarRoot.traverse((object) => {
          if ((object as Mesh).isMesh) object.visible = current.showBody && !current.garmentOnly;
        });

        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.12 : 1;
        const box = new Box3().setFromObject(avatarRoot);
        const height = Math.max(box.getSize(tmpDir).y, 1.5);
        const shoulderRadius = height * 0.038 * fitScale * (current.adjustments.width / 100);
        const sleeveMultiplier = current.adjustments.sleeveLength / 100;

        placeBetween(garment.leftUpperSleeve, rig.leftShoulder?.bone, rig.leftLowerArm?.bone, shoulderRadius, sleeveMultiplier);
        placeBetween(garment.rightUpperSleeve, rig.rightShoulder?.bone, rig.rightLowerArm?.bone, shoulderRadius, sleeveMultiplier);
        placeBetween(garment.leftLowerSleeve, rig.leftLowerArm?.bone, rig.leftHand?.bone, shoulderRadius * 0.9, sleeveMultiplier);
        placeBetween(garment.rightLowerSleeve, rig.rightLowerArm?.bone, rig.rightHand?.bone, shoulderRadius * 0.9, sleeveMultiplier);
        placeBetween(garment.leftLeg, rig.leftUpperLeg?.bone, rig.leftLowerLeg?.bone, height * 0.06 * fitScale, current.adjustments.legLength / 100);
        placeBetween(garment.rightLeg, rig.rightUpperLeg?.bone, rig.rightLowerLeg?.bone, height * 0.06 * fitScale, current.adjustments.legLength / 100);

        if (garment.torso) {
          const chest = rig.chest?.bone;
          const hips = rig.hips?.bone;
          if (chest && hips) {
            chest.getWorldPosition(tmpA);
            hips.getWorldPosition(tmpB);
            garment.torso.position.copy(tmpA).lerp(tmpB, 0.42);
            garment.torso.scale.set(height * 0.15 * fitScale * (current.adjustments.width / 100), height * 0.22 * (current.adjustments.length / 100), height * 0.1 * fitScale * (1 + current.adjustments.distance / 100));
          }
        }

        if (garment.hood) {
          const head = rig.head?.bone ?? rig.neck?.bone;
          if (head) {
            head.getWorldPosition(tmpA);
            garment.hood.position.copy(tmpA).add(new Vector3(0, height * 0.015, -height * 0.035));
            garment.hood.scale.setScalar(height * 0.11 * (current.adjustments.hoodSize / 50));
          }
        }

        garment.root.position.set(current.adjustments.x / 100, (current.adjustments.y + current.adjustments.height) / 100, current.adjustments.distance / 250);
        garment.root.rotation.y = (current.adjustments.rotation * Math.PI) / 180;
      }
      frameRef.current = requestAnimationFrame(update);
    };
    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => () => {
    dispose(garmentRef.current);
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
        alt="Vista previa 3D con ropa vinculada al rig CLOUVA"
        onReady={rebuild}
      />
    </div>
  );
}
