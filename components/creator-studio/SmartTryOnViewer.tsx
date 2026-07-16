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
  hips: ["hips", "pelvis", "jbiphips"],
  chest: ["upperchest", "chest", "spine2", "spine02", "jbipupperchest", "jbipchest"],
  neck: ["neck", "jbipneck"],
  head: ["head", "jbiphead"],
  leftShoulder: ["leftshoulder", "lshoulder", "shoulderl", "claviclel", "jbiplshoulder"],
  rightShoulder: ["rightshoulder", "rshoulder", "shoulderr", "clavicler", "jbiprshoulder"],
  leftUpperArm: ["leftupperarm", "upperarml", "lupperarm", "leftarm", "jbiplupperarm"],
  rightUpperArm: ["rightupperarm", "upperarmr", "rupperarm", "rightarm", "jbiprupperarm"],
  leftLowerArm: ["leftlowerarm", "lowerarml", "leftforearm", "lforearm", "jbipllowerarm"],
  rightLowerArm: ["rightlowerarm", "lowerarmr", "rightforearm", "rforearm", "jbiprlowerarm"],
  leftHand: ["lefthand", "handl", "lhand", "jbiplhand"],
  rightHand: ["righthand", "handr", "rhand", "jbiprhand"],
  leftUpperLeg: ["leftupperleg", "upperlegl", "thighl", "jbiplupperleg"],
  rightUpperLeg: ["rightupperleg", "upperlegr", "thighr", "jbiprupperleg"],
  leftLowerLeg: ["leftlowerleg", "lowerlegl", "calfl", "jbipllowerleg"],
  rightLowerLeg: ["rightlowerleg", "lowerlegr", "calfr", "jbiprlowerleg"],
};

const a = new Vector3();
const b = new Vector3();
const mid = new Vector3();
const dir = new Vector3();
const size = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const q = new Quaternion();
const e = new Euler();

function clean(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function entry(bone: Bone | undefined): RigEntry | undefined {
  return bone ? { bone, base: bone.quaternion.clone() } : undefined;
}

function collectRig(root: Object3D): Rig {
  root.updateMatrixWorld(true);
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
    if (found) rig[key] = entry(found);
  }

  if (!bones.length) return rig;

  const bounds = new Box3().setFromObject(root);
  bounds.getSize(size);
  const minY = bounds.min.y;
  const height = Math.max(size.y, 1);
  const position = (bone: Bone) => bone.getWorldPosition(new Vector3());
  const segments = bones.flatMap((parent) => parent.children
    .filter((child): child is Bone => (child as Bone).isBone)
    .map((child) => {
      const p1 = position(parent);
      const p2 = position(child);
      return { parent, child, p1, p2, midpoint: p1.clone().add(p2).multiplyScalar(0.5), delta: p2.clone().sub(p1) };
    }));

  const armSegments = segments.filter((segment) => {
    const relativeY = (segment.midpoint.y - minY) / height;
    return relativeY > 0.48 && Math.abs(segment.delta.x) > Math.abs(segment.delta.y) * 0.35;
  });

  function arm(side: "left" | "right") {
    const sign = side === "left" ? -1 : 1;
    const sideSegments = armSegments
      .filter((segment) => segment.midpoint.x * sign > 0)
      .sort((first, second) => Math.abs(first.midpoint.x) - Math.abs(second.midpoint.x));
    const upper = sideSegments[0];
    const lower = upper ? sideSegments.find((segment) => segment.parent === upper.child) : undefined;
    return { shoulder: upper?.parent, upper: upper?.child, lower: lower?.child, hand: lower?.child.children.find((child) => (child as Bone).isBone) as Bone | undefined };
  }

  const leftArm = arm("left");
  const rightArm = arm("right");
  rig.leftShoulder ??= entry(leftArm.shoulder);
  rig.rightShoulder ??= entry(rightArm.shoulder);
  rig.leftUpperArm ??= entry(leftArm.upper);
  rig.rightUpperArm ??= entry(rightArm.upper);
  rig.leftLowerArm ??= entry(leftArm.lower);
  rig.rightLowerArm ??= entry(rightArm.lower);
  rig.leftHand ??= entry(leftArm.hand);
  rig.rightHand ??= entry(rightArm.hand);

  const legSegments = segments.filter((segment) => {
    const relativeY = (segment.midpoint.y - minY) / height;
    return relativeY < 0.55 && Math.abs(segment.delta.y) > Math.abs(segment.delta.x) * 0.7;
  });

  function leg(side: "left" | "right") {
    const sign = side === "left" ? -1 : 1;
    const candidates = legSegments
      .filter((segment) => segment.midpoint.x * sign > 0)
      .sort((first, second) => second.midpoint.y - first.midpoint.y);
    const upper = candidates[0];
    const lower = upper ? candidates.find((segment) => segment.parent === upper.child) : undefined;
    return { upper: upper?.child, lower: lower?.child };
  }

  const leftLeg = leg("left");
  const rightLeg = leg("right");
  rig.leftUpperLeg ??= entry(leftLeg.upper);
  rig.rightUpperLeg ??= entry(rightLeg.upper);
  rig.leftLowerLeg ??= entry(leftLeg.lower);
  rig.rightLowerLeg ??= entry(rightLeg.lower);

  const central = bones
    .map((bone) => ({ bone, point: position(bone) }))
    .filter(({ point }) => Math.abs(point.x) < height * 0.08)
    .sort((first, second) => first.point.y - second.point.y);
  rig.hips ??= entry(central.find(({ point }) => (point.y - minY) / height > 0.35)?.bone);
  rig.chest ??= entry(central.find(({ point }) => (point.y - minY) / height > 0.62)?.bone);
  rig.neck ??= entry(central.find(({ point }) => (point.y - minY) / height > 0.76)?.bone);
  rig.head ??= entry(central.at(-1)?.bone);
  return rig;
}

function previewMaterial(texture: Texture | null) {
  return new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x7d4bd1,
    map: texture,
    roughness: 0.72,
    metalness: 0.02,
    clearcoat: 0.08,
    side: DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
}

function makeMesh(name: string, geometry: BoxGeometry | CylinderGeometry | SphereGeometry | TorusGeometry, material: MeshPhysicalMaterial) {
  const item = new Mesh(geometry, material);
  item.name = name;
  item.visible = false;
  item.castShadow = true;
  item.frustumCulled = false;
  return item;
}

function createGarment(category: string, texture: Texture | null): GarmentParts {
  const root = new Group();
  root.name = "clouva-rigged-preview";
  const material = previewMaterial(texture);
  const parts: GarmentParts = { root };

  if (["hoodie", "campera", "remera"].includes(category)) {
    parts.torso = makeMesh("torso", new SphereGeometry(1, 28, 20), material);
    parts.leftUpperSleeve = makeMesh("leftUpperSleeve", new CylinderGeometry(1, 1, 1, 18), material);
    parts.rightUpperSleeve = makeMesh("rightUpperSleeve", new CylinderGeometry(1, 1, 1, 18), material);
    parts.leftLowerSleeve = makeMesh("leftLowerSleeve", new CylinderGeometry(1, 1, 1, 18), material);
    parts.rightLowerSleeve = makeMesh("rightLowerSleeve", new CylinderGeometry(1, 1, 1, 18), material);
    root.add(parts.torso, parts.leftUpperSleeve, parts.rightUpperSleeve, parts.leftLowerSleeve, parts.rightLowerSleeve);
    if (category === "hoodie") {
      parts.hood = makeMesh("hood", new SphereGeometry(1, 24, 18), material);
      root.add(parts.hood);
    }
  } else if (category === "baggy") {
    parts.torso = makeMesh("waist", new CylinderGeometry(1, 1.12, 1, 22), material);
    parts.leftLeg = makeMesh("leftLeg", new CylinderGeometry(1, 1.12, 1, 18), material);
    parts.rightLeg = makeMesh("rightLeg", new CylinderGeometry(1, 1.12, 1, 18), material);
    root.add(parts.torso, parts.leftLeg, parts.rightLeg);
  } else if (category === "zapatillas") {
    parts.leftLeg = makeMesh("leftShoe", new BoxGeometry(1, 1, 1.6), material);
    parts.rightLeg = makeMesh("rightShoe", new BoxGeometry(1, 1, 1.6), material);
    root.add(parts.leftLeg, parts.rightLeg);
  } else if (category === "gorra") {
    parts.hood = makeMesh("cap", new SphereGeometry(1, 24, 16), material);
    root.add(parts.hood);
  } else if (category === "cadena") {
    parts.torso = makeMesh("chain", new TorusGeometry(1, 0.1, 10, 42), material);
    root.add(parts.torso);
  }
  return parts;
}

function poseBone(target: RigEntry | undefined, x: number, y: number, z: number) {
  if (!target) return;
  e.set(x, y, z, "XYZ");
  q.setFromEuler(e);
  target.bone.quaternion.copy(target.base).multiply(q);
}

function applyPose(rig: Rig, pose: Pose, elapsed: number) {
  const step = Math.sin(elapsed * 4.2);
  const breath = Math.sin(elapsed * 1.5);
  if (pose === "T-Pose") {
    poseBone(rig.leftUpperArm, 0, 0, Math.PI / 2 - 0.05);
    poseBone(rig.rightUpperArm, 0, 0, -Math.PI / 2 + 0.05);
    poseBone(rig.leftLowerArm, 0, 0, 0);
    poseBone(rig.rightLowerArm, 0, 0, 0);
    poseBone(rig.leftUpperLeg, 0, 0, 0);
    poseBone(rig.rightUpperLeg, 0, 0, 0);
  } else if (pose === "Walk") {
    poseBone(rig.leftUpperArm, -step * 0.38, 0, 0.1);
    poseBone(rig.rightUpperArm, step * 0.38, 0, -0.1);
    poseBone(rig.leftLowerArm, 0, 0, 0.08);
    poseBone(rig.rightLowerArm, 0, 0, -0.08);
    poseBone(rig.leftUpperLeg, step * 0.32, 0, 0);
    poseBone(rig.rightUpperLeg, -step * 0.32, 0, 0);
    poseBone(rig.leftLowerLeg, Math.max(0, -step) * 0.25, 0, 0);
    poseBone(rig.rightLowerLeg, Math.max(0, step) * 0.25, 0, 0);
    poseBone(rig.chest, -step * 0.025, 0, 0);
  } else {
    poseBone(rig.leftUpperArm, -0.02, 0, 0.1);
    poseBone(rig.rightUpperArm, -0.02, 0, -0.1);
    poseBone(rig.leftLowerArm, 0, 0, 0.04);
    poseBone(rig.rightLowerArm, 0, 0, -0.04);
    poseBone(rig.leftUpperLeg, 0, 0, 0);
    poseBone(rig.rightUpperLeg, 0, 0, 0);
    poseBone(rig.chest, breath * 0.012, 0, 0);
    poseBone(rig.head, breath * 0.006, 0, 0);
  }
}

function placeBetween(item: Mesh | undefined, start: Object3D | undefined, end: Object3D | undefined, radius: number, multiplier: number) {
  if (!item || !start || !end) {
    if (item) item.visible = false;
    return;
  }
  start.getWorldPosition(a);
  end.getWorldPosition(b);
  mid.copy(a).add(b).multiplyScalar(0.5);
  dir.copy(b).sub(a);
  const length = Math.max(dir.length() * multiplier, 0.01);
  dir.normalize();
  item.visible = true;
  item.position.copy(mid);
  item.quaternion.setFromUnitVectors(yAxis, dir);
  item.scale.set(radius, length * 0.5, radius);
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
  const propsRef = useRef({ fit, pose, showBody, garmentOnly, adjustments });
  propsRef.current = { fit, pose, showBody, garmentOnly, adjustments };

  const viewRotation = useMemo(() => view === "Frente" ? 0 : view === "Lateral" ? -Math.PI / 2 : Math.PI, [view]);
  const frontRotationY = avatar.frontRotationY + viewRotation;
  const poseMode: AvatarPoseMode = pose === "T-Pose" ? "tpose" : pose === "Walk" ? "walk" : "idle";

  function rebuild(root: Object3D) {
    avatarRef.current = root;
    rigRef.current = collectRig(root);
    dispose(garmentRef.current);
    const garment = createGarment(category, textureRef.current);
    garmentRef.current = garment;
    (root.parent ?? root).add(garment.root);
  }

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
        applyPose(rig, current.pose, elapsed);
        avatarRoot.position.y += current.pose === "Walk" ? Math.abs(Math.sin(elapsed * 4.2)) * 0.0015 : 0;
        avatarRoot.updateMatrixWorld(true);

        avatarRoot.traverse((object) => {
          if ((object as Mesh).isMesh) object.visible = current.showBody && !current.garmentOnly;
        });

        const bounds = new Box3().setFromObject(avatarRoot);
        bounds.getSize(size);
        const height = Math.max(size.y, 1.5);
        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.12 : 1;
        const radius = height * 0.034 * fitScale * (current.adjustments.width / 100);
        const sleeve = current.adjustments.sleeveLength / 100;

        placeBetween(garment.leftUpperSleeve, rig.leftShoulder?.bone ?? rig.leftUpperArm?.bone, rig.leftLowerArm?.bone, radius, sleeve);
        placeBetween(garment.rightUpperSleeve, rig.rightShoulder?.bone ?? rig.rightUpperArm?.bone, rig.rightLowerArm?.bone, radius, sleeve);
        placeBetween(garment.leftLowerSleeve, rig.leftLowerArm?.bone, rig.leftHand?.bone, radius * 0.9, sleeve);
        placeBetween(garment.rightLowerSleeve, rig.rightLowerArm?.bone, rig.rightHand?.bone, radius * 0.9, sleeve);
        placeBetween(garment.leftLeg, rig.leftUpperLeg?.bone, rig.leftLowerLeg?.bone, height * 0.055 * fitScale, current.adjustments.legLength / 100);
        placeBetween(garment.rightLeg, rig.rightUpperLeg?.bone, rig.rightLowerLeg?.bone, height * 0.055 * fitScale, current.adjustments.legLength / 100);

        if (garment.torso) {
          const chest = rig.chest?.bone;
          const hips = rig.hips?.bone;
          if (chest && hips) {
            chest.getWorldPosition(a);
            hips.getWorldPosition(b);
            garment.torso.visible = true;
            garment.torso.position.copy(a).lerp(b, 0.38);
            garment.torso.scale.set(height * 0.13 * fitScale * (current.adjustments.width / 100), height * 0.19 * (current.adjustments.length / 100), height * 0.085 * fitScale * (1 + current.adjustments.distance / 100));
          } else {
            garment.torso.visible = false;
          }
        }

        if (garment.hood) {
          const head = rig.head?.bone ?? rig.neck?.bone;
          if (head) {
            head.getWorldPosition(a);
            garment.hood.visible = true;
            garment.hood.position.copy(a).add(new Vector3(0, height * 0.005, -height * 0.035));
            garment.hood.scale.set(height * 0.09, height * 0.105, height * 0.075);
          } else {
            garment.hood.visible = false;
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
        alt="Vista previa 3D con ropa vinculada al avatar CLOUVA"
        onReady={rebuild}
      />
    </div>
  );
}
