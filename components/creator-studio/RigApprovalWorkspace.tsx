"use client";

import {
  Activity,
  Bone,
  Box,
  CheckCircle2,
  CircleAlert,
  Eye,
  Play,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Box3, Vector3 } from "three";
import type { Object3D, SkinnedMesh } from "three";
import { CreatorStudioAvatarViewer, type CreatorPoseMode } from "@/components/creator-studio/CreatorStudioAvatarViewer";
import { RiggedGarmentReviewViewer } from "@/components/library/RiggedGarmentReviewViewer";
import { StandaloneObjectPreview } from "@/components/library/StandaloneObjectPreview";
import type { ActiveAvatar } from "@/lib/avatar-engine/active-avatar-store";
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";
import styles from "./rig-approval-workspace.module.css";

export type RigInspectionMode = "model" | "bones" | "animation" | "diagnostics";

type RigProfile = {
  complete?: boolean;
  boneCount?: number;
  fingers?: { complete?: boolean; leftChains?: number; rightChains?: number; weightedVertices?: number };
  ears?: { complete?: boolean; left?: boolean; right?: boolean; weightedVertices?: number };
};

type RuntimeRigDiagnostics = {
  boneCount: number;
  skinnedMeshCount: number;
  leftFingerChains: number;
  rightFingerChains: number;
  leftEar: boolean;
  rightEar: boolean;
  headPresent: boolean;
  headGeometryOk: boolean;
  fingerGeometryOk: boolean;
  earGeometryOk: boolean;
  weightedVertices: number;
  totalVertices: number;
  weightedRatio: number;
  localScaleOk: boolean;
  animationReady: boolean;
  issues: string[];
  valid: boolean;
};

type Props = {
  avatar: ActiveAvatar;
  selectedModelUrl?: string;
  selectedModelName?: string;
  dressedPreview?: boolean;
  avatarRigReady: boolean;
  rigProfile?: RigProfile | null;
  revision: number;
  onStatus?: (status: string) => void;
  onApprovalChange?: (approved: boolean) => void;
};

const FINGER_NAMES = ["thumb", "index", "middle", "ring", "pinky"] as const;
const ARM_MARKERS = ["upperarm", "uparm", "shoulder", "clavicle", "forearm", "lowerarm", "elbow", "wrist", "hand", "arm"] as const;
const LEG_MARKERS = ["upperleg", "upleg", "thigh", "femur", "lowerleg", "calf", "shin", "knee", "ankle", "foot", "leg"] as const;

function normalizedName(value: string) {
  return value.toLowerCase().replace(/^mixamorig[:_]?/, "").replace(/[^a-z0-9]/g, "");
}

function sideOfBone(rawName: string, cleanName: string) {
  const lower = rawName.toLowerCase();
  if (cleanName.includes("left") || /(^|[_.:\- ])l($|[_.:\- ])/i.test(lower) || /_l$/i.test(lower)) return "left";
  if (cleanName.includes("right") || /(^|[_.:\- ])r($|[_.:\- ])/i.test(lower) || /_r$/i.test(lower)) return "right";
  return null;
}

function hasMarker(value: string, markers: readonly string[]) {
  return markers.some((marker) => value.includes(marker));
}

function hasUnitLocalScale(object: any) {
  const scale = object?.scale;
  return Boolean(scale) && [scale.x, scale.y, scale.z].every(
    (value: number) => Number.isFinite(value) && Math.abs(value - 1) <= 0.01,
  );
}

function isArmatureContainer(object: any, cleanName: string) {
  if (object?.isBone) return false;
  if (cleanName.includes("armature")) return true;
  return Array.isArray(object?.children) && object.children.some((child: any) => child?.isBone);
}

function generatedFingerInfo(rawName: string) {
  const match = rawName.toLowerCase().match(/^clouva_(thumb|index|middle|ring|pinky)_(\d{2})_([lr])$/);
  if (!match) return null;
  return {
    finger: match[1],
    segment: Number(match[2]),
    side: match[3] === "l" ? "left" as const : "right" as const,
  };
}

function inspectRig(root: Object3D): RuntimeRigDiagnostics {
  const bones = new Set<Object3D>();
  const boneList: Object3D[] = [];
  const leftFingers = new Set<string>();
  const rightFingers = new Set<string>();
  const generatedFingers = new Map<string, Object3D>();
  let leftEar = false;
  let rightEar = false;
  let leftEarBone: Object3D | null = null;
  let rightEarBone: Object3D | null = null;
  let headBone: Object3D | null = null;
  let headEndBone: Object3D | null = null;
  let leftHandBone: Object3D | null = null;
  let rightHandBone: Object3D | null = null;
  let skinnedMeshCount = 0;
  let weightedVertices = 0;
  let totalVertices = 0;
  let localScaleOk = true;
  let leftArm = false;
  let rightArm = false;
  let leftLeg = false;
  let rightLeg = false;

  root.updateMatrixWorld(true);
  root.traverse((object: any) => {
    const rawName = String(object.name ?? "");
    const cleanName = normalizedName(rawName);

    if (object.isBone) {
      const bone = object as Object3D;
      bones.add(bone);
      boneList.push(bone);
      const side = sideOfBone(rawName, cleanName);
      const generated = generatedFingerInfo(rawName);

      for (const finger of FINGER_NAMES) {
        if (!cleanName.includes(finger)) continue;
        if (side === "left") leftFingers.add(finger);
        if (side === "right") rightFingers.add(finger);
      }
      if (generated) generatedFingers.set(`${generated.side}:${generated.finger}:${generated.segment}`, bone);

      const exactHead = ["head", "headbone", "jbiphead", "bip01head"].includes(cleanName);
      const anatomicalHead = cleanName.includes("head")
        && !["end", "tip", "terminal", "effector"].some((token) => cleanName.includes(token));
      if (!headBone && (exactHead || anatomicalHead)) headBone = bone;
      if (!headEndBone && (cleanName.includes("headend") || cleanName.includes("headtip"))) headEndBone = bone;

      if (!leftHandBone && side === "left" && cleanName.includes("hand") && !FINGER_NAMES.some((finger) => cleanName.includes(finger))) {
        leftHandBone = bone;
      }
      if (!rightHandBone && side === "right" && cleanName.includes("hand") && !FINGER_NAMES.some((finger) => cleanName.includes(finger))) {
        rightHandBone = bone;
      }

      if (cleanName.includes("ear")) {
        if (side === "left") {
          leftEar = true;
          leftEarBone = bone;
        }
        if (side === "right") {
          rightEar = true;
          rightEarBone = bone;
        }
      }
      if (hasMarker(cleanName, ARM_MARKERS)) {
        if (side === "left") leftArm = true;
        if (side === "right") rightArm = true;
      }
      if (hasMarker(cleanName, LEG_MARKERS)) {
        if (side === "left") leftLeg = true;
        if (side === "right") rightLeg = true;
      }
    }

    if (object.isSkinnedMesh) {
      skinnedMeshCount += 1;
      const mesh = object as SkinnedMesh;
      for (const bone of mesh.skeleton?.bones ?? []) bones.add(bone);
      const skinWeight: any = mesh.geometry?.getAttribute?.("skinWeight");
      const position: any = mesh.geometry?.getAttribute?.("position");
      const count = Number(position?.count ?? skinWeight?.count ?? 0);
      totalVertices += count;
      if (skinWeight) {
        for (let index = 0; index < count; index += 1) {
          const sum = Number(skinWeight.getX?.(index) ?? 0)
            + Number(skinWeight.getY?.(index) ?? 0)
            + Number(skinWeight.getZ?.(index) ?? 0)
            + Number(skinWeight.getW?.(index) ?? 0);
          if (Number.isFinite(sum) && sum > 0.0001) weightedVertices += 1;
        }
      }
    }

    // Los huesos pueden contener escalas internas legítimas de la bind pose.
    // La regla 1,1,1 corresponde a la malla y al contenedor del armature, no a cada hueso.
    if ((object.isSkinnedMesh || isArmatureContainer(object, cleanName)) && !hasUnitLocalScale(object)) {
      localScaleOk = false;
    }
  });

  const box = new Box3().setFromObject(root);
  const center = box.getCenter(new Vector3());
  const height = Math.max(box.max.y - box.min.y, 0.001);
  const worldPosition = (object: Object3D) => object.getWorldPosition(new Vector3());
  const insidePaddedBounds = (point: Vector3) => (
    point.x >= box.min.x - height * 0.08
    && point.x <= box.max.x + height * 0.08
    && point.y >= box.min.y - height * 0.08
    && point.y <= box.max.y + height * 0.08
    && point.z >= box.min.z - height * 0.12
    && point.z <= box.max.z + height * 0.12
  );

  if (!headBone && boneList.length) {
    headBone = boneList
      .map((bone) => ({ bone, point: worldPosition(bone), name: normalizedName(bone.name) }))
      .filter(({ point, name }) => (
        Math.abs(point.x - center.x) <= height * 0.18
        && !["eye", "jaw", "mouth", "hand", "finger", "ear", "end", "tip"].some((token) => name.includes(token))
      ))
      .sort((a, b) => b.point.y - a.point.y)[0]?.bone ?? null;
  }

  if (!headEndBone && headBone) {
    headEndBone = boneList.find((bone) => {
      if (bone.parent !== headBone) return false;
      const name = normalizedName(bone.name);
      return name.includes("headend") || name.includes("headtip");
    }) ?? null;
  }

  const headPresent = Boolean(headBone);
  const headGeometryOk = Boolean(headBone && (() => {
    const point = worldPosition(headBone);
    const relativeY = (point.y - box.min.y) / height;
    const crown = headEndBone ? worldPosition(headEndBone) : null;
    const crownDistance = crown ? point.distanceTo(crown) : height * 0.095;
    return relativeY >= 0.68
      && relativeY <= 0.94
      && crownDistance >= height * 0.025
      && crownDistance <= height * 0.20
      && Math.abs(point.x - center.x) <= height * 0.20
      && insidePaddedBounds(point);
  })());

  const lateralAxis = (() => {
    if (!leftHandBone || !rightHandBone) return new Vector3(1, 0, 0);
    const axis = worldPosition(leftHandBone).sub(worldPosition(rightHandBone));
    return axis.lengthSq() > 1e-10 ? axis.normalize() : new Vector3(1, 0, 0);
  })();

  const chainGeometryOk = (side: "left" | "right", finger: string) => {
    const first = generatedFingers.get(`${side}:${finger}:1`);
    const second = generatedFingers.get(`${side}:${finger}:2`);
    const third = generatedFingers.get(`${side}:${finger}:3`);
    if (!first || !second || !third) return false;

    const firstPoint = worldPosition(first);
    const secondPoint = worldPosition(second);
    const thirdPoint = worldPosition(third);
    const firstLength = firstPoint.distanceTo(secondPoint);
    const secondLength = secondPoint.distanceTo(thirdPoint);
    const chainDirection = thirdPoint.clone().sub(firstPoint);
    if (chainDirection.lengthSq() < 1e-10) return false;
    chainDirection.normalize();

    const hand = side === "left" ? leftHandBone : rightHandBone;
    const handPoint = hand ? worldPosition(hand) : null;
    const handLink = handPoint ? handPoint.distanceTo(firstPoint) : Number.POSITIVE_INFINITY;
    const parent = hand?.parent && (hand.parent as any).isBone ? hand.parent as Object3D : null;
    const continuation = parent && handPoint
      ? handPoint.clone().sub(worldPosition(parent))
      : null;
    const followsHand = Boolean(continuation && continuation.lengthSq() > 1e-10
      && chainDirection.dot(continuation.normalize()) >= 0.30);
    const lateralAlignment = Math.abs(chainDirection.dot(lateralAxis));

    return firstLength >= height * 0.003
      && firstLength <= height * 0.035
      && secondLength >= height * 0.003
      && secondLength <= height * 0.035
      && handLink <= height * 0.075
      && followsHand
      && lateralAlignment <= 0.72
      && insidePaddedBounds(firstPoint)
      && insidePaddedBounds(secondPoint)
      && insidePaddedBounds(thirdPoint);
  };

  const fingerGeometryOk = (["left", "right"] as const).every((side) => (
    FINGER_NAMES.every((finger) => chainGeometryOk(side, finger))
  ));

  const expectedEarY = (() => {
    if (!headBone) return box.min.y + height * 0.865;
    const headPoint = worldPosition(headBone);
    if (headEndBone) return (headPoint.y + worldPosition(headEndBone).y) * 0.5;
    return headPoint.y + height * 0.060;
  })();

  const earPositionOk = (ear: Object3D | null, expectedSide: "left" | "right") => {
    if (!ear) return false;
    const point = worldPosition(ear);
    const relativeY = (point.y - box.min.y) / height;
    const signedLateral = point.clone().sub(center).dot(lateralAxis);
    const lateral = Math.abs(signedLateral);
    const depth = Math.abs(point.z - center.z);
    const correctSide = expectedSide === "left" ? signedLateral > 0 : signedLateral < 0;
    return relativeY >= 0.78
      && relativeY <= 0.98
      && Math.abs(point.y - expectedEarY) <= height * 0.060
      && correctSide
      && lateral >= height * 0.020
      && lateral <= height * 0.13
      && depth <= height * 0.16
      && insidePaddedBounds(point);
  };
  const earSymmetryOk = Boolean(leftEarBone && rightEarBone
    && Math.abs(worldPosition(leftEarBone).y - worldPosition(rightEarBone).y) <= height * 0.020);
  const earGeometryOk = earPositionOk(leftEarBone, "left")
    && earPositionOk(rightEarBone, "right")
    && earSymmetryOk;

  const weightedRatio = totalVertices > 0 ? weightedVertices / totalVertices : 0;
  const namedLimbsReady = leftArm && rightArm && leftLeg && rightLeg;
  const structurallyCompleteRig = bones.size >= 40 && leftFingers.size >= 5 && rightFingers.size >= 5;
  const animationReady = namedLimbsReady || structurallyCompleteRig;
  const issues = [
    !headPresent ? "falta el hueso Head" : null,
    headPresent && !headGeometryOk ? "Head no llega correctamente a la coronilla" : null,
    !fingerGeometryOk ? "los dedos no siguen el eje y ancho real de las manos" : null,
    !earGeometryOk ? "las orejas no están centradas y simétricas sobre la cabeza" : null,
    weightedRatio < 0.995 ? `pesos incompletos (${(weightedRatio * 100).toFixed(1)}%)` : null,
    !localScaleOk ? "Mesh o Armature no están en escala 1,1,1" : null,
    !animationReady ? "faltan cadenas de brazos o piernas" : null,
  ].filter((value): value is string => Boolean(value));

  const valid = bones.size >= 20
    && skinnedMeshCount > 0
    && leftFingers.size >= 5
    && rightFingers.size >= 5
    && leftEar
    && rightEar
    && headPresent
    && headGeometryOk
    && fingerGeometryOk
    && earGeometryOk
    && weightedRatio >= 0.995
    && localScaleOk
    && animationReady;

  return {
    boneCount: bones.size,
    skinnedMeshCount,
    leftFingerChains: leftFingers.size,
    rightFingerChains: rightFingers.size,
    leftEar,
    rightEar,
    headPresent,
    headGeometryOk,
    fingerGeometryOk,
    earGeometryOk,
    weightedVertices,
    totalVertices,
    weightedRatio,
    localScaleOk,
    animationReady,
    issues,
    valid,
  };
}

function DiagnosticRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li data-ok={ok}>
      {ok ? <CheckCircle2 /> : <CircleAlert />}
      <span>{children}</span>
    </li>
  );
}

export function RigApprovalWorkspace({
  avatar,
  selectedModelUrl,
  selectedModelName,
  dressedPreview = false,
  avatarRigReady,
  rigProfile,
  revision,
  onStatus,
  onApprovalChange,
}: Props) {
  const [mode, setMode] = useState<RigInspectionMode>(avatarRigReady ? "bones" : "model");
  const [pose, setPose] = useState<CreatorPoseMode>("idle");
  const [diagnostics, setDiagnostics] = useState<RuntimeRigDiagnostics | null>(null);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    setApproved(false);
    setDiagnostics(null);
    setMode(avatarRigReady ? "bones" : "model");
    setPose("idle");
    onApprovalChange?.(false);
  }, [avatar.id, avatar.modelUrl, avatarRigReady, revision, onApprovalChange]);

  const handleReady = useCallback((root: Object3D) => {
    const next = inspectRig(root);
    setDiagnostics(next);
    if (next.valid) {
      onStatus?.(`Rig cargado en el visor: ${next.boneCount} huesos, cabeza, dedos alineados con las manos, orejas, pesos y escala validados.`);
    } else {
      onStatus?.(`Rig rechazado: ${next.issues.join(" · ") || "la anatomía no coincide con la malla"}. Abrí Diagnóstico y después tocá Rehacer rig.`);
    }
  }, [onStatus]);

  const effective = useMemo(() => ({
    boneCount: diagnostics?.boneCount ?? rigProfile?.boneCount ?? 0,
    leftFingerChains: diagnostics?.leftFingerChains ?? rigProfile?.fingers?.leftChains ?? 0,
    rightFingerChains: diagnostics?.rightFingerChains ?? rigProfile?.fingers?.rightChains ?? 0,
    leftEar: diagnostics?.leftEar ?? rigProfile?.ears?.left ?? false,
    rightEar: diagnostics?.rightEar ?? rigProfile?.ears?.right ?? false,
    headPresent: diagnostics?.headPresent ?? false,
    headGeometryOk: diagnostics?.headGeometryOk ?? false,
    fingerGeometryOk: diagnostics?.fingerGeometryOk ?? false,
    earGeometryOk: diagnostics?.earGeometryOk ?? false,
    weightedRatio: diagnostics?.weightedRatio ?? ((rigProfile?.fingers?.weightedVertices ?? 0) > 0 ? 1 : 0),
    localScaleOk: diagnostics?.localScaleOk ?? false,
    animationReady: diagnostics?.animationReady ?? false,
    skinnedMeshCount: diagnostics?.skinnedMeshCount ?? 0,
    valid: avatarRigReady && diagnostics?.valid === true,
  }), [avatarRigReady, diagnostics, rigProfile]);

  const approve = () => {
    if (!effective.valid) return;
    setApproved(true);
    onApprovalChange?.(true);
    onStatus?.("Rig aprobado en el visor. Ya se puede preparar el FBX para Unreal.");
  };

  const rigPose = pose === "tpose" ? "T-Pose" : pose === "walk" ? "Walk" : "Idle";
  const avatarInspectionMode = mode === "bones" || mode === "diagnostics" || (mode === "animation" && !dressedPreview);

  return (
    <div className={styles.root} data-approved={approved}>
      <div className={styles.toolbar} aria-label="Modos del visor de rig">
        <button type="button" data-active={mode === "model"} onClick={() => setMode("model")}><Box /> Modelo</button>
        <button type="button" data-active={mode === "bones"} onClick={() => setMode("bones")} disabled={!avatarRigReady}><Bone /> Huesos</button>
        <button type="button" data-active={mode === "animation"} onClick={() => setMode("animation")} disabled={!avatarRigReady}><Play /> Animación</button>
        <button type="button" data-active={mode === "diagnostics"} onClick={() => setMode("diagnostics")} disabled={!avatarRigReady}><ScanSearch /> Diagnóstico</button>
      </div>

      {mode === "animation" ? (
        <div className={styles.poseBar}>
          <button type="button" data-active={pose === "idle"} onClick={() => setPose("idle")}>Idle</button>
          <button type="button" data-active={pose === "tpose"} onClick={() => setPose("tpose")}>T-Pose</button>
          <button type="button" data-active={pose === "walk"} onClick={() => setPose("walk")}>Caminar</button>
        </div>
      ) : null}

      <div className={styles.stage} key={`${revision}:${mode}:${avatar.id}:${selectedModelUrl ?? "avatar"}`}>
        {avatarInspectionMode ? (
          <CreatorStudioAvatarViewer
            modelUrl={avatar.modelUrl}
            fallbackModelUrl={avatar.fallbackUrl}
            frontRotationY={avatar.frontRotationY}
            viewRotationY={0}
            config={defaultAvatarConfig}
            poseMode={mode === "animation" ? pose : "idle"}
            showSkeleton={mode === "bones" || mode === "diagnostics"}
            className="h-full min-h-[500px] w-full"
            onReady={handleReady}
          />
        ) : dressedPreview && selectedModelUrl ? (
          <RiggedGarmentReviewViewer
            modelUrl={selectedModelUrl}
            pose={rigPose}
            view="Frente"
            showAvatar
            showGarment
            showRig={false}
            onStatus={onStatus}
          />
        ) : selectedModelUrl ? (
          <StandaloneObjectPreview modelUrl={selectedModelUrl} />
        ) : (
          <CreatorStudioAvatarViewer
            modelUrl={avatar.modelUrl}
            fallbackModelUrl={avatar.fallbackUrl}
            frontRotationY={avatar.frontRotationY}
            viewRotationY={0}
            config={defaultAvatarConfig}
            poseMode="idle"
            className="h-full min-h-[500px] w-full"
            onReady={handleReady}
          />
        )}
      </div>

      {mode === "diagnostics" ? (
        <section className={styles.diagnostics} aria-label="Diagnóstico del rig">
          <header>
            <div><Activity /><span><small>RIG DEL AVATAR</small><strong>{effective.valid ? "Listo para aprobar" : "Revisión necesaria"}</strong></span></div>
            <span className={effective.valid ? styles.validBadge : styles.invalidBadge}>{effective.valid ? "VALIDADO" : "PENDIENTE"}</span>
          </header>
          <ul>
            <DiagnosticRow ok={effective.boneCount >= 20}>Armature detectado · {effective.boneCount || "—"} huesos</DiagnosticRow>
            <DiagnosticRow ok={effective.headPresent && effective.headGeometryOk}>Cabeza conectada hasta la coronilla</DiagnosticRow>
            <DiagnosticRow ok={effective.leftFingerChains >= 5}>5 dedos en mano izquierda · {effective.leftFingerChains}/5</DiagnosticRow>
            <DiagnosticRow ok={effective.rightFingerChains >= 5}>5 dedos en mano derecha · {effective.rightFingerChains}/5</DiagnosticRow>
            <DiagnosticRow ok={effective.fingerGeometryOk}>Dedos dentro de las manos y siguiendo su dirección real</DiagnosticRow>
            <DiagnosticRow ok={effective.leftEar && effective.rightEar}>Huesos de oreja izquierda y derecha</DiagnosticRow>
            <DiagnosticRow ok={effective.earGeometryOk}>Orejas simétricas y ubicadas sobre la cabeza</DiagnosticRow>
            <DiagnosticRow ok={effective.skinnedMeshCount > 0}>Malla vinculada al armature · {effective.skinnedMeshCount || "—"}</DiagnosticRow>
            <DiagnosticRow ok={effective.weightedRatio >= 0.995}>Vértices con peso · {(effective.weightedRatio * 100).toFixed(1)}%</DiagnosticRow>
            <DiagnosticRow ok={effective.localScaleOk}>Mesh y Armature con escala local 1,1,1</DiagnosticRow>
            <DiagnosticRow ok={effective.animationReady}>Brazos y piernas disponibles para animación</DiagnosticRow>
          </ul>
        </section>
      ) : null}

      <div className={styles.approvalBar}>
        <div>
          {approved ? <ShieldCheck /> : effective.valid ? <Eye /> : <CircleAlert />}
          <span><strong>{approved ? "Rig aprobado" : effective.valid ? "Rig listo para aprobación" : "Rig anatómico incorrecto"}</strong><small>{approved ? "Se habilitó la preparación del FBX" : effective.valid ? "Revisá visualmente y aprobalo" : "Tocá Rehacer rig para regenerar cabeza, orejas y dedos"}</small></span>
        </div>
        <button type="button" onClick={approve} disabled={!effective.valid || approved}>
          <ShieldCheck /> {approved ? "Aprobado" : "Aprobar rig"}
        </button>
      </div>

      <span className={styles.modelName}>{selectedModelName || "Avatar activo"}</span>
    </div>
  );
}
