"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import styles from "./avatar-analyzer-v4-diagnostics.module.css";

type LandmarkState =
  | "verified"
  | "verified_with_fallback"
  | "needs_review"
  | "unsupported_by_topology"
  | "no_visual_evidence"
  | "technically_invalid"
  | "manually_verified";

type Landmark = {
  name?: string;
  state?: LandmarkState;
  region?: string;
  final_confidence?: number;
  evidenceState?: string;
  invalidCameraEvidence?: string[];
  rejectionReasons?: string[];
};

type RootCause = {
  id: string;
  code: string;
  scope?: string;
  summary?: string;
  affected_landmark_count?: number;
  affected_landmarks?: string[];
  cameras?: string[];
  possible_cause?: string;
  automatic_action_attempted?: string;
  required_user_action?: string;
};

type AnalyzerResult = {
  summary?: {
    status?: string;
    requestedRigProfile?: string;
    supportedRigProfiles?: string[];
    recommendedNextAction?: string;
  };
  analysis?: {
    overall_status?: string;
    requested_rig_profile?: string;
    supported_rig_profiles?: string[];
    landmarks?: Record<string, Landmark>;
    root_causes?: RootCause[];
    topology_capabilities?: Record<string, unknown>;
    camera_calibration?: {
      valid_views?: string[];
      invalid_views?: string[];
    };
    recommended_next_action?: string;
  };
  assets?: {
    diagnosticGlb?: string;
    renders?: string[];
  };
};

type RegionKey = "body" | "face" | "left_hand" | "right_hand";

const REGION_LABELS: Record<RegionKey, string> = {
  body: "Cuerpo",
  face: "Cara",
  left_hand: "Mano izquierda",
  right_hand: "Mano derecha",
};

const STATE_LABELS: Record<LandmarkState, string> = {
  verified: "Verificado",
  verified_with_fallback: "Fallback verificado",
  needs_review: "Necesita revisión",
  unsupported_by_topology: "No soportado",
  no_visual_evidence: "Sin evidencia visual",
  technically_invalid: "Inválido técnicamente",
  manually_verified: "Verificado manualmente",
};

function regionOf(name: string, landmark: Landmark): RegionKey {
  if (name.endsWith("_l") && /^(thumb|index|middle|ring|pinky|wrist|hand)_/.test(name)) return "left_hand";
  if (name.endsWith("_r") && /^(thumb|index|middle|ring|pinky|wrist|hand)_/.test(name)) return "right_hand";
  if (/^(eye|nose|mouth|jaw|chin|ear|brow|cheek|forehead)/.test(name) || landmark.region === "face") return "face";
  return "body";
}

function stateClass(state?: LandmarkState) {
  if (state === "verified" || state === "manually_verified") return styles.verified;
  if (state === "verified_with_fallback") return styles.fallback;
  if (state === "unsupported_by_topology") return styles.unsupported;
  return styles.blocking;
}

export default function AvatarAnalyzerV4Diagnostics({
  result,
  assetBaseUrl,
}: {
  result: AnalyzerResult;
  assetBaseUrl: string;
}) {
  const analysis = result.analysis ?? {};
  const landmarks = analysis.landmarks ?? {};
  const rootCauses = analysis.root_causes ?? [];
  const supportedProfiles = analysis.supported_rig_profiles ?? result.summary?.supportedRigProfiles ?? [];
  const requestedProfile = analysis.requested_rig_profile ?? result.summary?.requestedRigProfile ?? "BODY_BASIC";
  const [region, setRegion] = useState<RegionKey>("body");
  const [selectedCause, setSelectedCause] = useState<string | null>(rootCauses[0]?.id ?? null);
  const [heatmap, setHeatmap] = useState(false);
  const [showRays, setShowRays] = useState(true);

  const regionLandmarks = useMemo(
    () => Object.entries(landmarks).filter(([name, item]) => regionOf(name, item) === region),
    [landmarks, region],
  );
  const cause = rootCauses.find((item) => item.id === selectedCause) ?? rootCauses[0];
  const renders = result.assets?.renders ?? [];
  const preferredRender = renders.find((path) => {
    if (region === "face") return path.includes("face_front.png");
    if (region === "left_hand") return path.includes("hand_l_palmar.png");
    if (region === "right_hand") return path.includes("hand_r_palmar.png");
    return path.includes("body_front.png");
  });
  const canRigRequested = supportedProfiles.includes(requestedProfile);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CLOUVA · AVATAR ANALYZER V4.0</span>
          <h1>Diagnóstico anatómico</h1>
          <p>{cause?.summary ?? "Análisis sin causas raíz bloqueantes"}</p>
        </div>
        <div className={`${styles.overall} ${canRigRequested ? styles.verified : styles.blocking}`}>
          <strong>{analysis.overall_status ?? result.summary?.status ?? "unknown"}</strong>
          <span>{requestedProfile}</span>
        </div>
      </header>

      <nav className={styles.regionTabs} aria-label="Regiones anatómicas">
        {(Object.keys(REGION_LABELS) as RegionKey[]).map((key) => (
          <button
            type="button"
            key={key}
            className={region === key ? styles.activeTab : ""}
            onClick={() => setRegion(key)}
          >
            {REGION_LABELS[key]}
          </button>
        ))}
      </nav>

      <section className={styles.workspace}>
        <div className={`${styles.viewer} ${heatmap ? styles.heatmap : ""}`}>
          <div className={styles.viewerToolbar}>
            <button type="button" onClick={() => setHeatmap((value) => !value)}>
              {heatmap ? "Ocultar heatmap" : "Heatmap por región"}
            </button>
            <button type="button" onClick={() => setShowRays((value) => !value)}>
              {showRays ? "Ocultar raycasts" : "Mostrar raycasts"}
            </button>
          </div>
          {preferredRender ? (
            <Image
              src={`${assetBaseUrl}/${preferredRender}`}
              alt={`Vista ${REGION_LABELS[region]}`}
              fill
              unoptimized
              sizes="(max-width: 900px) 100vw, 66vw"
            />
          ) : (
            <div className={styles.viewerEmpty}>
              <strong>{REGION_LABELS[region]}</strong>
              <span>El visor GLB usa {result.assets?.diagnosticGlb ?? "diagnostic_landmarks.glb"}</span>
            </div>
          )}
          {showRays && cause?.cameras?.length ? (
            <div className={styles.cameraBadge}>Cámaras: {cause.cameras.join(", ")}</div>
          ) : null}
        </div>

        <aside className={styles.sidePanel}>
          <section>
            <h2>Causas raíz</h2>
            <div className={styles.causes}>
              {rootCauses.length ? rootCauses.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selectedCause === item.id ? styles.selectedCause : ""}
                  onClick={() => {
                    setSelectedCause(item.id);
                    if (item.scope?.includes("face")) setRegion("face");
                    if (item.scope?.includes("left")) setRegion("left_hand");
                    if (item.scope?.includes("right") && item.scope !== "shoulder_r") setRegion("right_hand");
                    if (item.scope === "shoulder_r") setRegion("body");
                  }}
                >
                  <strong>{item.code}</strong>
                  <span>{item.summary ?? `${item.affected_landmark_count ?? 0} afectados`}</span>
                </button>
              )) : <p className={styles.muted}>No hay causas raíz activas.</p>}
            </div>
          </section>

          {cause ? (
            <section className={styles.causeDetail}>
              <h2>{cause.code}</h2>
              <dl>
                <div><dt>Posible causa</dt><dd>{cause.possible_cause}</dd></div>
                <div><dt>Acción automática</dt><dd>{cause.automatic_action_attempted}</dd></div>
                <div><dt>Acción requerida</dt><dd>{cause.required_user_action}</dd></div>
              </dl>
              <details>
                <summary>Landmarks afectados</summary>
                <p>{cause.affected_landmarks?.join(", ") || "Sin lista detallada"}</p>
              </details>
            </section>
          ) : null}
        </aside>
      </section>

      <section className={styles.landmarkSection}>
        <div className={styles.sectionHeading}>
          <h2>{REGION_LABELS[region]}</h2>
          <span>{regionLandmarks.length} landmarks</span>
        </div>
        <div className={styles.landmarkGrid}>
          {regionLandmarks.map(([name, item]) => (
            <article key={name} className={`${styles.landmarkCard} ${stateClass(item.state)}`}>
              <div><strong>{name}</strong><span>{STATE_LABELS[item.state ?? "needs_review"]}</span></div>
              <b>{Math.round((item.final_confidence ?? 0) * 100)}%</b>
              <small>{item.evidenceState ?? item.rejectionReasons?.[0] ?? "Sin detalle"}</small>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.actions}>
        <button type="button" className={styles.secondaryAction}>Corregir análisis</button>
        <div>
          <span>Soportados: {supportedProfiles.join(", ") || "ninguno"}</span>
          <button type="button" className={styles.primaryAction} disabled={!canRigRequested}>
            Analizar y riggear {requestedProfile}
          </button>
        </div>
      </footer>
    </main>
  );
}
