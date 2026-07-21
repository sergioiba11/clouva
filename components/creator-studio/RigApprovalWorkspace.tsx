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
  weightedVertices: number;
  totalVertices: number;
  weightedRatio: number;
  localScaleOk: boolean;
  animationReady: boolean;
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

function normalizedName(value: string) {
  return value.toLowerCase().replace(/^mixamorig[:_]?/, "").replace(/[^a-z0-9]/g, "");
}

function sideOfBone(rawName: string, cleanName: string) {
  const lower = rawName.toLowerCase();
  if (cleanName.includes("left") || /(^|[_.:\- ])l($|[_.:\- ])/i.test(lower) || /_l$/i.test(lower)) return "left";
  if (cleanName.includes("right") || /(^|[_.:\- ])r($|[_.:\- ])/i.test(lower) || /_r$/i.test(lower)) return "right";
  return null;
}

function inspectRig(root: Object3D): RuntimeRigDiagnostics {
  const bones = new Set<Object3D>();
  const leftFingers = new Set<string>();
  const rightFingers = new Set<string>();
  let leftEar = false;
  let rightEar = false;
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
      bones.add(object as Object3D);
      const side = sideOfBone(rawName, cleanName);
      for (const finger of FINGER_NAMES) {
        if (!cleanName.includes(finger)) continue;
        if (side === "left") leftFingers.add(finger);
        if (side === "right") rightFingers.add(finger);
      }
      if (cleanName.includes("ear")) {
        if (side === "left") leftEar = true;
        if (side === "right") rightEar = true;
      }
      if (cleanName.includes("upperarm") || cleanName.includes("shoulder")) {
        if (side === "left") leftArm = true;
        if (side === "right") rightArm = true;
      }
      if (cleanName.includes("upperleg") || cleanName.includes("thigh")) {
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

    if ((object.isBone || object.isSkinnedMesh || cleanName.includes("armature")) && object !== root) {
      const scale = object.scale;
      if (!scale || [scale.x, scale.y, scale.z].some((value: number) => !Number.isFinite(value) || Math.abs(value - 1) > 0.001)) {
        localScaleOk = false;
      }
    }
  });

  const weightedRatio = totalVertices > 0 ? weightedVertices / totalVertices : 0;
  const animationReady = leftArm && rightArm && leftLeg && rightLeg;
  const valid = bones.size >= 20
    && skinnedMeshCount > 0
    && leftFingers.size >= 5
    && rightFingers.size >= 5
    && leftEar
    && rightEar
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
    weightedVertices,
    totalVertices,
    weightedRatio,
    localScaleOk,
    animationReady,
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
      onStatus?.(`Rig cargado en el visor: ${next.boneCount} huesos, dedos, orejas, pesos y escala validados.`);
    } else {
      onStatus?.("El rig se cargó, pero todavía tiene comprobaciones pendientes. Abrí Diagnóstico.");
    }
  }, [onStatus]);

  const effective = useMemo(() => ({
    boneCount: diagnostics?.boneCount ?? rigProfile?.boneCount ?? 0,
    leftFingerChains: diagnostics?.leftFingerChains ?? rigProfile?.fingers?.leftChains ?? 0,
    rightFingerChains: diagnostics?.rightFingerChains ?? rigProfile?.fingers?.rightChains ?? 0,
    leftEar: diagnostics?.leftEar ?? rigProfile?.ears?.left ?? false,
    rightEar: diagnostics?.rightEar ?? rigProfile?.ears?.right ?? false,
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
            <DiagnosticRow ok={effective.leftFingerChains >= 5}>5 dedos en mano izquierda · {effective.leftFingerChains}/5</DiagnosticRow>
            <DiagnosticRow ok={effective.rightFingerChains >= 5}>5 dedos en mano derecha · {effective.rightFingerChains}/5</DiagnosticRow>
            <DiagnosticRow ok={effective.leftEar && effective.rightEar}>Huesos de oreja izquierda y derecha</DiagnosticRow>
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
          <span><strong>{approved ? "Rig aprobado" : effective.valid ? "Rig listo para aprobación" : "Abrí Huesos y Diagnóstico"}</strong><small>{approved ? "Se habilitó la preparación del FBX" : "Unreal permanece bloqueado hasta aprobar este rig"}</small></span>
        </div>
        <button type="button" onClick={approve} disabled={!effective.valid || approved}>
          <ShieldCheck /> {approved ? "Aprobado" : "Aprobar rig"}
        </button>
      </div>

      <span className={styles.modelName}>{selectedModelName || "Avatar activo"}</span>
    </div>
  );
}
