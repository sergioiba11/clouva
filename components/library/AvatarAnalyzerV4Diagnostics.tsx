"use client";

import Image from "next/image";
import { createElement, useMemo, useRef, useState } from "react";
import versionContract from "@/worker/garment-rig/avatar_analyzer_version.json";
import styles from "./avatar-analyzer-v4-diagnostics.module.css";

type RegionKey = "body" | "face" | "left_hand" | "right_hand";
type LayerKey =
  | "originalMesh"
  | "anatomicalRegions"
  | "surfaceLandmarks"
  | "internalJoints"
  | "boneChains"
  | "centerlines"
  | "raycasts"
  | "rejected"
  | "boundaryTriangles"
  | "confidenceHeatmap"
  | "boundingVolumes"
  | "manualCorrections";

type Landmark = {
  name?: string;
  state?: string;
  region?: string;
  landmarkType?: string;
  final_confidence?: number;
  finalConfidence?: number;
  evidenceState?: string;
  verificationMethod?: string;
  invalidCameraEvidence?: string[];
  rejectionReasons?: string[];
  rejection_reasons?: string[];
  views?: number;
  inliers?: number;
  position?: number[];
  displayPosition?: number[];
  worldPosition?: number[];
  triangleId?: number;
  barycentric?: number[];
  manualCorrection?: number[];
  candidateScores?: Array<Record<string, unknown>>;
  projection?: {
    requestedRgbPixel?: number[];
    mappedTechnicalPixel?: number[];
    selectedTechnicalPixel?: number[];
    expectedRegion?: string;
    hitRegion?: string;
    depth?: number;
    triangleId?: number;
    barycentric?: number[];
    candidateScores?: Array<Record<string, unknown>>;
  };
};

type RootCause = {
  id?: string;
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

type Readiness = {
  bodyRigScore?: number;
  bodyRigReady?: boolean;
  faceAnalysisScore?: number;
  faceAnalysisReady?: boolean;
  leftHandBaseReady?: boolean;
  rightHandBaseReady?: boolean;
  leftFingerRigReady?: boolean;
  rightFingerRigReady?: boolean;
  fullHumanoidRigReady?: boolean;
  unrealExportReady?: boolean;
};

type AnalyzerResult = {
  id?: string;
  runId?: string;
  createdAt?: string;
  source?: {
    sha256?: string;
    filename?: string;
  };
  summary?: {
    status?: string;
    requestedRigProfile?: string;
    supportedRigProfiles?: string[];
    recommendedNextAction?: string;
    readiness?: Readiness;
  } & Readiness;
  analysis?: {
    analyzer_version?: string;
    map_version?: string;
    overall_status?: string;
    requested_rig_profile?: string;
    supported_rig_profiles?: string[];
    landmarks?: Record<string, Landmark>;
    root_causes?: RootCause[];
    readiness?: Readiness;
    camera_calibration?: {
      valid_views?: string[];
      invalid_views?: string[];
    };
    topology_capabilities?: Record<string, unknown>;
    recommended_next_action?: string;
  } & Readiness;
  assets?: {
    diagnosticGlb?: string;
    renders?: string[];
  };
};

const REGION_LABELS: Record<RegionKey, string> = {
  body: "Cuerpo",
  face: "Cara",
  left_hand: "Mano izquierda",
  right_hand: "Mano derecha",
};

const LAYERS: Array<{ key: LayerKey; label: string; tone: string }> = [
  { key: "originalMesh", label: "Malla original", tone: "#c6c2cf" },
  { key: "anatomicalRegions", label: "Regiones anatómicas", tone: "#8d6cff" },
  { key: "surfaceLandmarks", label: "Landmarks de superficie", tone: "#44e3a1" },
  { key: "internalJoints", label: "Articulaciones internas", tone: "#7bc8ff" },
  { key: "boneChains", label: "Cadenas óseas", tone: "#f6d365" },
  { key: "centerlines", label: "Centerlines", tone: "#f09aff" },
  { key: "raycasts", label: "Raycasts", tone: "#ffaf5f" },
  { key: "rejected", label: "Rechazados", tone: "#ff5c74" },
  { key: "boundaryTriangles", label: "Triángulos de frontera", tone: "#f8ea70" },
  { key: "confidenceHeatmap", label: "Heatmap de confianza", tone: "#a855f7" },
  { key: "boundingVolumes", label: "Volúmenes anatómicos", tone: "#58dcf4" },
  { key: "manualCorrections", label: "Correcciones manuales", tone: "#ffffff" },
];

const INITIAL_LAYERS: Record<LayerKey, boolean> = {
  originalMesh: true,
  anatomicalRegions: true,
  surfaceLandmarks: true,
  internalJoints: true,
  boneChains: true,
  centerlines: false,
  raycasts: true,
  rejected: true,
  boundaryTriangles: false,
  confidenceHeatmap: false,
  boundingVolumes: false,
  manualCorrections: true,
};

const APPROVED_STATES = new Set([
  "verified_visual_geometry",
  "verified_geometry_fallback",
  "verified_single_view_depth",
  "manually_corrected",
]);

function regionOf(name: string, landmark: Landmark): RegionKey {
  if (name.endsWith("_l") && /^(thumb|index|middle|ring|pinky|wrist|hand)_/.test(name)) return "left_hand";
  if (name.endsWith("_r") && /^(thumb|index|middle|ring|pinky|wrist|hand)_/.test(name)) return "right_hand";
  if (/^(eye|nose|mouth|jaw|chin|ear|brow|cheek|forehead)/.test(name) || landmark.region === "face") return "face";
  return "body";
}

function stateLabel(state = "insufficient_views") {
  const labels: Record<string, string> = {
    verified_visual_geometry: "Geometría visual verificada",
    verified_geometry_fallback: "Fallback geométrico verificado",
    verified_single_view_depth: "Profundidad de una vista verificada",
    inferred_template_prior: "Inferido por prior",
    manually_corrected: "Corrección manual",
    insufficient_views: "Vistas insuficientes",
    projection_mismatch: "Proyección inconsistente",
    topology_invalid: "Topología no válida",
    unsupported: "No soportado",
    corrupt_geometry: "Geometría corrupta",
  };
  return labels[state] ?? state;
}

function stateTone(state = "insufficient_views") {
  if (state === "manually_corrected") return styles.manual;
  if (state === "verified_geometry_fallback" || state === "verified_single_view_depth") return styles.fallback;
  if (APPROVED_STATES.has(state)) return styles.verified;
  if (state === "unsupported") return styles.unsupported;
  return styles.blocking;
}

function confidenceOf(landmark?: Landmark) {
  return landmark?.final_confidence ?? landmark?.finalConfidence ?? 0;
}

function joinAsset(base: string, path: string) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function boolLabel(value?: boolean) {
  return value ? "LISTO" : "BLOQUEADO";
}

function percent(value?: number) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function vector(value?: number[]) {
  return value?.length ? value.map((part) => Number(part).toFixed(3)).join(", ") : "—";
}

export default function AvatarAnalyzerV4Diagnostics({
  result,
  assetBaseUrl,
}: {
  result: AnalyzerResult;
  assetBaseUrl: string;
}) {
  const analysis = result.analysis ?? {};
  const landmarks = useMemo(() => analysis.landmarks ?? {}, [analysis.landmarks]);
  const rootCauses = analysis.root_causes ?? [];
  const supportedProfiles = analysis.supported_rig_profiles ?? result.summary?.supportedRigProfiles ?? [];
  const requestedProfile = analysis.requested_rig_profile ?? result.summary?.requestedRigProfile ?? "body_only";
  const readiness: Readiness = {
    ...(result.summary?.readiness ?? {}),
    ...(analysis.readiness ?? {}),
    ...result.summary,
    ...analysis,
  };
  const [region, setRegion] = useState<RegionKey>("body");
  const [selectedCauseIndex, setSelectedCauseIndex] = useState(0);
  const [selectedLandmark, setSelectedLandmark] = useState<string | null>(null);
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [xray, setXray] = useState(false);
  const [compareManual, setCompareManual] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const regionLandmarks = useMemo(
    () => Object.entries(landmarks).filter(([name, item]) => regionOf(name, item) === region),
    [landmarks, region],
  );
  const rejectedLandmarks = useMemo(
    () => Object.entries(landmarks).filter(([, item]) => !APPROVED_STATES.has(item.state ?? "")),
    [landmarks],
  );
  const currentCause = rootCauses[selectedCauseIndex] ?? rootCauses[0];
  const selectedEntry = selectedLandmark
    ? ([selectedLandmark, landmarks[selectedLandmark]] as const)
    : regionLandmarks[0];
  const selected = selectedEntry?.[1];
  const renders = (result.assets?.renders ?? []).filter((path) => path.toLowerCase().endsWith(".png"));
  const evidenceRenders = renders.filter((path) => {
    if (region === "face") return path.includes("face_");
    if (region === "left_hand") return path.includes("hand_l_");
    if (region === "right_hand") return path.includes("hand_r_");
    return path.includes("body_");
  }).slice(0, 7);
  const diagnosticGlb = result.assets?.diagnosticGlb;
  const canRigRequested = supportedProfiles.includes(requestedProfile);
  const displayPosition = compareManual && selected?.manualCorrection
    ? selected.manualCorrection
    : selected?.displayPosition ?? selected?.worldPosition ?? selected?.position;
  const projection = selected?.projection ?? {};

  function selectCause(index: number) {
    const cause = rootCauses[index];
    setSelectedCauseIndex(index);
    const first = cause?.affected_landmarks?.[0];
    if (first) {
      setSelectedLandmark(first);
      setRegion(regionOf(first, landmarks[first] ?? {}));
      return;
    }
    if (cause?.scope?.includes("face")) setRegion("face");
    else if (cause?.scope?.includes("left")) setRegion("left_hand");
    else if (cause?.scope?.includes("right") && cause.scope !== "shoulder_r") setRegion("right_hand");
    else setRegion("body");
  }

  function selectNextError() {
    if (!rejectedLandmarks.length) return;
    const current = rejectedLandmarks.findIndex(([name]) => name === selectedLandmark);
    const next = rejectedLandmarks[(current + 1 + rejectedLandmarks.length) % rejectedLandmarks.length];
    setSelectedLandmark(next[0]);
    setRegion(regionOf(next[0], next[1]));
  }

  async function toggleFullscreen() {
    if (!viewerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await viewerRef.current.requestFullscreen();
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CLOUVA · AVATAR ANALYZER V4.1</span>
          <h1>Diagnóstico anatómico</h1>
          <p>{currentCause?.summary ?? "Sin causas raíz bloqueantes detectadas."}</p>
        </div>
        <div className={`${styles.overall} ${canRigRequested ? styles.verified : styles.blocking}`}>
          <span>Perfil solicitado</span>
          <strong>{requestedProfile}</strong>
          <small>{analysis.overall_status ?? result.summary?.status ?? "unknown"}</small>
        </div>
      </header>

      <section className={styles.runMeta} aria-label="Trazabilidad del análisis">
        <span>Backend <b>{analysis.analyzer_version ?? versionContract.analyzerVersion}</b></span>
        <span>Frontend <b>{versionContract.frontendVersion}</b></span>
        <span>Mapa <b>{analysis.map_version ?? versionContract.mapVersion}</b></span>
        <span>SHA <b>{result.source?.sha256?.slice(0, 12) ?? "sin dato"}</b></span>
        <span>Run <b>{result.runId ?? result.id ?? "sin dato"}</b></span>
        <span>Fecha <b>{result.createdAt ? new Date(result.createdAt).toLocaleString("es-AR") : "sin dato"}</b></span>
      </section>

      <section className={styles.readinessGrid} aria-label="Readiness por subsistema">
        {[
          ["Body rig", readiness.bodyRigReady, readiness.bodyRigScore],
          ["Análisis facial", readiness.faceAnalysisReady, readiness.faceAnalysisScore],
          ["Base mano izquierda", readiness.leftHandBaseReady, undefined],
          ["Dedos izquierdos", readiness.leftFingerRigReady, undefined],
          ["Base mano derecha", readiness.rightHandBaseReady, undefined],
          ["Dedos derechos", readiness.rightFingerRigReady, undefined],
          ["Humanoide completo", readiness.fullHumanoidRigReady, undefined],
          ["Export Unreal", readiness.unrealExportReady, undefined],
        ].map(([label, ready, score]) => (
          <article key={String(label)} className={ready ? styles.ready : styles.notReady}>
            <span>{label}</span>
            <b>{boolLabel(ready as boolean | undefined)}</b>
            {typeof score === "number" ? <small>{percent(score)}</small> : null}
          </article>
        ))}
      </section>

      <nav className={styles.regionTabs} aria-label="Regiones anatómicas">
        {(Object.keys(REGION_LABELS) as RegionKey[]).map((key) => (
          <button
            type="button"
            key={key}
            className={region === key ? styles.activeTab : ""}
            onClick={() => {
              setRegion(key);
              setSelectedLandmark(null);
            }}
          >
            {REGION_LABELS[key]}
          </button>
        ))}
      </nav>

      <section className={styles.workspace}>
        <aside className={styles.layerPanel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.kicker}>ESCENA</span>
              <h2>Capas de diagnóstico</h2>
            </div>
            <button type="button" onClick={() => setLayers(INITIAL_LAYERS)}>Reset</button>
          </div>
          <div className={styles.layerList}>
            {LAYERS.map((layer) => (
              <label key={layer.key}>
                <i style={{ background: layer.tone }} />
                <span>{layer.label}</span>
                <input
                  type="checkbox"
                  checked={layers[layer.key]}
                  onChange={() => setLayers((current) => ({ ...current, [layer.key]: !current[layer.key] }))}
                />
              </label>
            ))}
          </div>
          <div className={styles.legend}>
            <h3>Leyenda</h3>
            <span><i className={styles.legendVerified} />Verificado visual</span>
            <span><i className={styles.legendFallback} />Fallback geométrico</span>
            <span><i className={styles.legendRejected} />Rechazado / bloqueante</span>
            <span><i className={styles.legendManual} />Corrección manual</span>
          </div>
        </aside>

        <div
          ref={viewerRef}
          className={[
            styles.viewer,
            xray ? styles.xray : "",
            layers.confidenceHeatmap ? styles.heatmap : "",
          ].filter(Boolean).join(" ")}
        >
          <div className={styles.viewerToolbar}>
            <button type="button" className={xray ? styles.toolActive : ""} onClick={() => setXray((value) => !value)}>
              X-Ray
            </button>
            <button type="button" onClick={selectNextError} disabled={!rejectedLandmarks.length}>
              Siguiente error ({rejectedLandmarks.length})
            </button>
            <button type="button" onClick={toggleFullscreen}>Pantalla completa</button>
          </div>
          {diagnosticGlb ? createElement("model-viewer", {
            src: joinAsset(assetBaseUrl, diagnosticGlb),
            alt: "Avatar diagnóstico CLOUVA con landmarks anatómicos",
            "camera-controls": true,
            "touch-action": "pan-y",
            "shadow-intensity": "0.65",
            exposure: "1.05",
            "environment-image": "neutral",
            autoplay: false,
            class: styles.modelViewer,
          }) : (
            <div className={styles.viewerEmpty}>
              <strong>{REGION_LABELS[region]}</strong>
              <span>No se publicó el GLB diagnóstico para este run.</span>
            </div>
          )}
          {selectedEntry ? (
            <div className={`${styles.selectionBadge} ${stateTone(selected?.state)}`}>
              <span>Landmark seleccionado</span>
              <b>{selectedEntry[0]}</b>
              <small>{stateLabel(selected?.state)} · {percent(confidenceOf(selected))}</small>
            </div>
          ) : null}
          {layers.raycasts && currentCause?.cameras?.length ? (
            <div className={styles.cameraBadge}>Cámaras: {currentCause.cameras.join(", ")}</div>
          ) : null}
        </div>

        <aside className={styles.inspector}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.kicker}>INSPECTOR</span>
              <h2>{selectedEntry?.[0] ?? "Sin selección"}</h2>
            </div>
            <span className={`${styles.statePill} ${stateTone(selected?.state)}`}>{stateLabel(selected?.state)}</span>
          </div>
          {selected ? (
            <>
              <div className={styles.score}>
                <strong>{percent(confidenceOf(selected))}</strong>
                <span>confianza final</span>
              </div>
              <dl className={styles.metrics}>
                <div><dt>Tipo</dt><dd>{selected.landmarkType ?? "surface_landmark"}</dd></div>
                <div><dt>Método</dt><dd>{selected.verificationMethod ?? selected.evidenceState ?? "—"}</dd></div>
                <div><dt>Vistas / inliers</dt><dd>{selected.views ?? 0} / {selected.inliers ?? 0}</dd></div>
                <div><dt>Posición</dt><dd>{vector(displayPosition)}</dd></div>
                <div><dt>Triángulo</dt><dd>{projection.triangleId ?? selected.triangleId ?? "—"}</dd></div>
                <div><dt>Baricéntricas</dt><dd>{vector(projection.barycentric ?? selected.barycentric)}</dd></div>
                <div><dt>Pixel RGB pedido</dt><dd>{vector(projection.requestedRgbPixel)}</dd></div>
                <div><dt>Pixel técnico</dt><dd>{vector(projection.mappedTechnicalPixel)}</dd></div>
                <div><dt>Región esperada / hit</dt><dd>{projection.expectedRegion ?? "—"} / {projection.hitRegion ?? "—"}</dd></div>
                <div><dt>Depth</dt><dd>{projection.depth?.toFixed(4) ?? "—"}</dd></div>
              </dl>
              {selected.manualCorrection ? (
                <label className={styles.compare}>
                  <span>Comparar automático / manual</span>
                  <input
                    type="checkbox"
                    checked={compareManual}
                    onChange={() => setCompareManual((value) => !value)}
                  />
                </label>
              ) : null}
              {(selected.rejectionReasons ?? selected.rejection_reasons)?.length ? (
                <div className={styles.rejectionBox}>
                  <strong>Motivos de rechazo</strong>
                  <ul>
                    {(selected.rejectionReasons ?? selected.rejection_reasons)?.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              ) : null}
            </>
          ) : <p className={styles.muted}>Elegí un landmark para inspeccionar toda su evidencia.</p>}
        </aside>
      </section>

      <section className={styles.evidenceSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.kicker}>EVIDENCIA MULTIVISTA</span>
            <h2>{REGION_LABELS[region]}</h2>
          </div>
          <span>Hasta 7 cámaras · RGB → pase técnico → triángulo</span>
        </div>
        <div className={styles.evidenceStrip}>
          {evidenceRenders.length ? evidenceRenders.map((path) => (
            <article key={path} className={styles.evidenceCard}>
              <div className={styles.evidenceImage}>
                <Image src={joinAsset(assetBaseUrl, path)} alt={`Evidencia ${path}`} fill unoptimized sizes="220px" />
                <span>{path.split("/").pop()?.replace(".png", "")}</span>
              </div>
              <dl>
                <div><dt>RGB</dt><dd>{vector(projection.requestedRgbPixel)}</dd></div>
                <div><dt>Técnico</dt><dd>{vector(projection.selectedTechnicalPixel ?? projection.mappedTechnicalPixel)}</dd></div>
                <div><dt>Región</dt><dd>{projection.expectedRegion ?? "—"} → {projection.hitRegion ?? "—"}</dd></div>
                <div><dt>Tri / depth</dt><dd>{projection.triangleId ?? selected?.triangleId ?? "—"} / {projection.depth?.toFixed(3) ?? "—"}</dd></div>
              </dl>
            </article>
          )) : <p className={styles.muted}>Este run no publicó capturas multivista para la región.</p>}
        </div>
      </section>

      <section className={styles.lowerGrid}>
        <div className={styles.landmarkSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>LANDMARKS</span>
              <h2>{REGION_LABELS[region]}</h2>
            </div>
            <span>{regionLandmarks.length} puntos</span>
          </div>
          <div className={styles.landmarkGrid}>
            {regionLandmarks.map(([name, item]) => (
              <button
                type="button"
                key={name}
                className={`${styles.landmarkCard} ${stateTone(item.state)} ${selectedLandmark === name ? styles.selectedLandmark : ""}`}
                onClick={() => setSelectedLandmark(name)}
              >
                <span><strong>{name}</strong><small>{stateLabel(item.state)}</small></span>
                <b>{percent(confidenceOf(item))}</b>
              </button>
            ))}
          </div>
        </div>

        <aside className={styles.rootCausePanel}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>CAUSAS RAÍZ</span>
              <h2>Diagnóstico accionable</h2>
            </div>
            <span>{rootCauses.length}</span>
          </div>
          <div className={styles.causes}>
            {rootCauses.length ? rootCauses.map((cause, index) => (
              <button
                type="button"
                key={cause.id ?? `${cause.code}-${index}`}
                className={index === selectedCauseIndex ? styles.selectedCause : ""}
                onClick={() => selectCause(index)}
              >
                <strong>{cause.code}</strong>
                <span>{cause.summary ?? `${cause.affected_landmark_count ?? 0} landmarks afectados`}</span>
              </button>
            )) : <p className={styles.muted}>No hay causas raíz activas.</p>}
          </div>
          {currentCause ? (
            <dl className={styles.causeDetail}>
              <div><dt>Posible causa</dt><dd>{currentCause.possible_cause ?? "—"}</dd></div>
              <div><dt>Acción automática</dt><dd>{currentCause.automatic_action_attempted ?? "—"}</dd></div>
              <div><dt>Acción requerida</dt><dd>{currentCause.required_user_action ?? "—"}</dd></div>
            </dl>
          ) : null}
        </aside>
      </section>

      <footer className={styles.actions}>
        <button type="button" className={styles.secondaryAction}>Corregir análisis</button>
        <div>
          <span>Perfiles soportados: {supportedProfiles.join(", ") || "ninguno"}</span>
          <button type="button" className={styles.primaryAction} disabled={!canRigRequested}>
            Analizar y riggear {requestedProfile}
          </button>
        </div>
      </footer>
    </main>
  );
}
