import React, { Suspense, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { Canvas } from "@react-three/fiber";
import { Bounds, Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import "./styles.css";
import { installWorkspaceAuthBridge } from "./workspaceAuthBridge";
import { AVATAR_CAMERA, AVATAR_ORBIT_TARGET, hasGlbHeader, summarizeGarmentResult, validateFitPayload } from "./viewerScene";

const API_PORT = import.meta.env.VITE_ANALYZER_API_PORT || "8000";
const API = `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
const APP_VERSION = "v1.3.6";
const REQUIRED_GARMENT_ANALYSIS_VERSION = "clouva-garment-upright-contract-v1.3.6";
const RECOVERY_KEY = "clouva-anatomy-lab-last-workspace";

function readRecoveryState() {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECOVERY_KEY) || "null");
    return value && typeof value.runId === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeRecoveryState(value) {
  if (!value?.runId) window.localStorage.removeItem(RECOVERY_KEY);
  else window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(value));
}

const BODY_HEAD_NAMES = new Set([
  "nose", "left_eye_inner", "left_eye", "left_eye_outer",
  "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right",
]);

const READINESS_LABELS = {
  body_ready: "Cuerpo listo",
  face_landmarks_ready: "Cara lista",
  left_hand_ready: "Mano izquierda lista",
  right_hand_ready: "Mano derecha lista",
  earring_anchors_ready: "Pines de lóbulos listos",
  measurements_ready: "Medidas corporales validadas",
  circumferences_ready: "Contornos cerrados exactos",
  circumferences_estimated_ready: "Contornos estimados disponibles",
  garment_anchors_ready: "Puntos de confección listos",
  garment_mold_draft_ready: "Base preliminar para molde",
  garment_mold_input_ready: "Base final para molde",
};

function Avatar({ url }) {
  const gltf = useGLTF(url);
  const clone = useMemo(() => gltf.scene.clone(true), [gltf]);

  useEffect(() => {
    clone.traverse((object) => {
      if (object.isMesh) {
        object.material = new THREE.MeshStandardMaterial({
          color: "#6b3ef2",
          roughness: 0.58,
          metalness: 0.12,
          transparent: true,
          opacity: 0.82,
        });
      }
    });
  }, [clone]);

  return <primitive object={clone} />;
}

class ViewerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("[anatomy-viewer] No se pudo renderizar la escena", error);
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="viewer-error" role="alert">
        <strong>No se pudo mostrar el resultado 3D</strong>
        <span>{this.state.error instanceof Error ? this.state.error.message : "El renderer rechazó el GLB generado."}</span>
        <button onClick={this.props.onReset}>Volver al avatar</button>
      </div>
    );
  }
}

class ApplicationErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("[anatomy-lab] Error no recuperable en la interfaz", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error" role="alert">
        <strong>El resultado se generó, pero la interfaz no pudo mostrarlo</strong>
        <span>{this.state.error instanceof Error ? this.state.error.message : "Error desconocido de interfaz."}</span>
        <button onClick={() => window.location.reload()}>Recuperar Analyzer</button>
      </main>
    );
  }
}

function GarmentPreview({ url, preserveMaterials = false, wireframe = false }) {
  const gltf = useGLTF(url);
  const clone = useMemo(() => gltf.scene.clone(true), [gltf]);

  useEffect(() => {
    clone.traverse((object) => {
      if (!object.isMesh) return;
      if (preserveMaterials) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const clonedMaterials = materials.map((material) => {
          const next = material?.clone ? material.clone() : new THREE.MeshStandardMaterial({ color: "#59e7ff" });
          next.transparent = false;
          next.opacity = 1;
          next.side = THREE.DoubleSide;
          next.depthWrite = true;
          next.depthTest = true;
          next.wireframe = wireframe;
          return next;
        });
        object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0];
      } else {
        object.material = new THREE.MeshStandardMaterial({
          color: "#59e7ff",
          emissive: "#182a55",
          roughness: 0.42,
          metalness: 0.08,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
          wireframe,
        });
      }
      object.renderOrder = 4;
    });
  }, [clone, preserveMaterials, wireframe]);

  return <primitive object={clone} />;
}

function GarmentAnalysisMarkers({ analysis, selectedName, onSelect }) {
  const boundsMin = analysis?.geometry?.semantic_bounds_min || [0, 0, 0];
  const boundsMax = analysis?.geometry?.semantic_bounds_max || [0, 0, 0];
  const center = boundsMin.map((value, index) => (Number(value) + Number(boundsMax[index] || 0)) * 0.5);
  const quality = analysis?.landmark_quality || {};
  return Object.entries(analysis?.landmarks || {}).map(([name, value]) => {
    if (!Array.isArray(value) || value.length !== 3) return null;
    const position = value.map((coordinate, index) => Number(coordinate) - center[index]);
    const active = selectedName === name;
    const meta = quality[name] || {};
    const structural = meta.landmark_type === "structural_internal" || meta.surface_locked === false;
    const color = structural
      ? "#ff63d8"
      : name.includes("neck")
        ? "#ffe84a"
        : name.includes("shoulder") || name.includes("armhole")
          ? "#59e7ff"
          : "#b695ff";
    return (
      <group key={name} position={position}>
        <mesh
          scale={active ? 1.65 : 1}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.({
              name,
              group: structural ? "garment_structural" : "garment_surface",
              state: structural ? "structural_internal" : "surface_locked",
              confidence: Number(meta.confidence || 0),
              source_position: value,
              vertex_index: meta.vertex_index,
              source_surface_vertex_index: meta.source_surface_vertex_index,
              method: meta.method,
              distance_normalized: meta.distance_normalized,
              front_depth: meta.front_depth,
              back_depth: meta.back_depth,
              midpoint_depth: meta.midpoint_depth,
              depth_span: meta.depth_span,
              sample_count: meta.sample_count,
            });
          }}
        >
          <sphereGeometry args={[structural ? 0.0075 : 0.0065, 12, 12]} />
          <meshBasicMaterial
            color={active ? "#ffffff" : color}
            depthTest={!structural}
            transparent
            opacity={structural ? 0.96 : 1}
          />
        </mesh>
        {active && (
          <Html distanceFactor={9} style={{ pointerEvents: "none" }}>
            <span className="garment-marker-label">{name.replaceAll("_", " ")}</span>
          </Html>
        )}
      </group>
    );
  });
}

function GarmentStandaloneViewer({ url, analysis, rotationTurns, wireframe, showLandmarks, showBounds, showAxes, selectedLandmark, onSelectLandmark }) {
  const size = analysis?.geometry?.semantic_size || [1, 1, 1];
  const turns = rotationTurns || { x: 0, y: 0, z: 0 };
  const rotation = [
    (Number(turns.x || 0) % 4) * Math.PI / 2,
    (Number(turns.y || 0) % 4) * Math.PI / 2,
    (Number(turns.z || 0) % 4) * Math.PI / 2,
  ];
  const axisLength = Math.max(...size.map(Number), 0.5) * 0.75;
  return (
    <Canvas camera={{ position: [0, -2.8, 1.2], fov: 42, up: [0, 0, 1] }}>
      <ambientLight intensity={1.2} />
      <directionalLight position={[4, -4, 6]} intensity={2.2} />
      <Suspense fallback={<Html center>Cargando prenda…</Html>}>
        <Bounds fit clip observe margin={1.35}>
          <group rotation={rotation}>
            {url && <GarmentPreview url={url} preserveMaterials wireframe={wireframe} />}
            {showLandmarks && analysis && <GarmentAnalysisMarkers analysis={analysis} selectedName={selectedLandmark?.group?.startsWith("garment_") ? selectedLandmark.name : null} onSelect={onSelectLandmark} />}
            {showBounds && analysis && (
              <mesh>
                <boxGeometry args={size.map((value) => Math.max(Number(value), 0.001))} />
                <meshBasicMaterial color="#59e7ff" wireframe transparent opacity={0.55} />
              </mesh>
            )}
            {showAxes && <axesHelper args={[axisLength]} />}
            {showAxes && (
              <mesh position={[0, 0, 0]}>
                <sphereGeometry args={[axisLength * 0.025, 12, 12]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            )}
          </group>
        </Bounds>
        <Environment preset="city" />
      </Suspense>
      <gridHelper args={[10, 30, "#3c246d", "#181023"]} rotation={[Math.PI / 2, 0, 0]} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}

function Markers({ landmarks, visibleGroups, selected, onSelect }) {
  return landmarks
    .filter((item) => visibleGroups[item.group] !== false)
    .map((item, index) => {
      const p = item.source_position || item.canonical_position;
      if (!Array.isArray(p) || p.length !== 3) return null;
      const color = item.group === "face_rejected"
        ? "#ff405f"
        : item.group === "anchor"
          ? (item.state === "surface_anchor_ready" ? "#ffe84a" : "#ff8a3d")
          : item.group === "garment_anchor"
            ? (item.state === "surface_anchor_ready" ? "#ff63d8" : "#ff9b5a")
          : item.group === "face"
            ? "#68f5ad"
            : item.group === "face_detail"
              ? "#43c98f"
              : item.group === "hand"
                ? "#58e6ff"
                : item.group === "internal"
                  ? "#7f8cff"
                  : item.group === "body_head"
                    ? "#76599e"
                    : "#b695ff";
      const radius = item.group === "face" || item.group === "face_detail" || item.group === "face_rejected"
        ? 0.0032
        : item.group === "anchor"
          ? 0.0045
          : item.group === "garment_anchor"
            ? 0.0055
          : item.group === "hand"
            ? 0.005
            : item.group === "internal"
              ? 0.006
              : 0.008;
      const active = selected === item;
      return (
        <mesh
          key={`${item.group}-${item.side}-${item.name}-${index}`}
          position={p}
          scale={active ? 1.7 : 1}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(item);
          }}
        >
          {item.group === "anchor"
            ? <sphereGeometry args={[radius, 16, 16]} />
            : <sphereGeometry args={[radius, 12, 12]} />}
          <meshBasicMaterial color={active ? "#ffffff" : color} />
        </mesh>
      );
    });
}

function Viewer({ modelUrl, garmentUrl, garmentPreviewKind, showGarment, result, visibleGroups, selected, onSelect }) {
  return (
    <Canvas camera={AVATAR_CAMERA}>
      <ambientLight intensity={1.2} />
      <directionalLight position={[4, -4, 6]} intensity={2.2} />
      <Suspense fallback={<Html center>Cargando GLB…</Html>}>
        <Bounds fit clip margin={1.42}>
          {modelUrl && visibleGroups?.body !== false && <Avatar url={modelUrl} />}
          {garmentUrl && showGarment && <GarmentPreview url={garmentUrl} preserveMaterials={garmentPreviewKind === "library" || garmentPreviewKind === "fitted"} />}
        </Bounds>
        {result && (
          <Markers
            landmarks={[
                ...(result.landmarks || []).map((item) => {
                  if (item.group === "face" && String(item.name || "").startsWith("face_")) {
                    return { ...item, group: "face_detail" };
                  }
                  if (item.group === "body" && BODY_HEAD_NAMES.has(String(item.name || ""))) {
                    return { ...item, group: "body_head" };
                  }
                  return item;
                }),
                ...((result.accessory_anchors?.earrings || [])
                  .filter((item) => item.state === "surface_anchor_ready")
                  .map((item) => ({
                    ...item,
                    group: "anchor",
                  }))),
                ...((result.garment_anchors || []).map((item) => ({
                  ...item,
                  group: "garment_anchor",
                }))),
                ...(visibleGroups.face_rejected ? (result.rejected_face_landmarks || []).map((item) => ({
                  ...item,
                  group: "face_rejected",
                })) : []),
                ...(result.internal_joints || []).map((item) => ({
                  ...item,
                  group: "internal",
                  state: "derived_internal",
                  source_position: item.source_position || null,
                  triangle_id: null,
                  mesh_id: "internal",
                  barycentric: null,
                  confirmed_views: item.source_landmarks || [],
                })),
            ]}
            visibleGroups={visibleGroups}
            selected={selected}
            onSelect={onSelect}
          />
        )}
        <Environment preset="city" />
      </Suspense>
      <gridHelper args={[10, 30, "#3c246d", "#181023"]} position={[0, -0.002, 0]} />
      <OrbitControls makeDefault enableDamping target={AVATAR_ORBIT_TARGET} />
    </Canvas>
  );
}

function App() {
  const initialRecovery = useMemo(() => readRecoveryState(), []);
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [workspaceManagedAuth, setWorkspaceManagedAuth] = useState(false);
  const [email, setEmail] = useState("");
  const [attemptedUserId, setAttemptedUserId] = useState(null);
  const [activeAvatar, setActiveAvatar] = useState(null);
  const [clouvaLoading, setClouvaLoading] = useState(false);

  const [file, setFile] = useState(null);
  const [heightCm, setHeightCm] = useState(180);
  const [modelUrl, setModelUrl] = useState(null);
  const [runId, setRunId] = useState(initialRecovery?.runId || null);
  const [progress, setProgress] = useState(initialRecovery
    ? { progress: 100, message: "Recuperando el último resultado…" }
    : { progress: 0, message: "Conectá CLOUVA o elegí un GLB" });
  const [result, setResult] = useState(null);
  const [garmentResult, setGarmentResult] = useState(initialRecovery?.fitPayload || null);
  const [garmentAnalysis, setGarmentAnalysis] = useState(null);
  const [garmentAnalysisUrl, setGarmentAnalysisUrl] = useState(null);
  const [garmentAnalysisAccepted, setGarmentAnalysisAccepted] = useState(false);
  const [garmentRotationTurns, setGarmentRotationTurns] = useState({ x: 0, y: 0, z: 0 });
  const [garmentUprightConfirmed, setGarmentUprightConfirmed] = useState(false);
  const [garmentFrontConfirmed, setGarmentFrontConfirmed] = useState(false);
  const [garmentLandmarksConfirmed, setGarmentLandmarksConfirmed] = useState(false);
  const [garmentWireframe, setGarmentWireframe] = useState(false);
  const [showGarmentLandmarks, setShowGarmentLandmarks] = useState(true);
  const [showGarmentBounds, setShowGarmentBounds] = useState(true);
  const [showGarmentAxes, setShowGarmentAxes] = useState(true);
  const [workspaceTab, setWorkspaceTab] = useState("avatar");
  const [garmentUrl, setGarmentUrl] = useState(null);
  const [garmentFit, setGarmentFit] = useState("oversized");
  const [garmentBusy, setGarmentBusy] = useState(false);
  const [garmentError, setGarmentError] = useState(null);
  const [libraryAssets, setLibraryAssets] = useState([]);
  const [selectedAssetKey, setSelectedAssetKey] = useState("");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("Todas");
  const [garmentPreviewKind, setGarmentPreviewKind] = useState("fitted");
  const [showGarment, setShowGarment] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [visibleGroups, setVisibleGroups] = useState({
    body: true,
    body_head: false,
    face: true,
    face_detail: false,
    face_rejected: false,
    hand: true,
    anchor: true,
    garment_anchor: true,
    internal: false,
  });

  const libraryCategories = useMemo(() => {
    return ["Todas", ...Array.from(new Set(libraryAssets.map((item) => item.category_label).filter(Boolean))).sort()];
  }, [libraryAssets]);

  const filteredLibraryAssets = useMemo(() => {
    const search = librarySearch.trim().toLowerCase();
    return libraryAssets.filter((item) => {
      const categoryOk = libraryCategory === "Todas" || item.category_label === libraryCategory;
      const text = `${item.name || ""} ${item.file_name || ""} ${item.category || ""} ${item.source_label || ""}`.toLowerCase();
      return categoryOk && (!search || text.includes(search));
    });
  }, [libraryAssets, librarySearch, libraryCategory]);

  const selectedLibraryAsset = useMemo(() => {
    return libraryAssets.find((item) => item.asset_key === selectedAssetKey) || null;
  }, [libraryAssets, selectedAssetKey]);

  useEffect(() => {
    if (initialRecovery?.fitPayload && (!selectedAssetKey || initialRecovery.fitPayload.template?.asset_key === selectedAssetKey)) return;
    setGarmentAnalysis(null);
    setGarmentAnalysisUrl(null);
    setGarmentAnalysisAccepted(false);
    setGarmentRotationTurns({ x: 0, y: 0, z: 0 });
    setGarmentUprightConfirmed(false);
    setGarmentFrontConfirmed(false);
    setGarmentLandmarksConfirmed(false);
    setSelected(null);
    setGarmentResult(null);
    setGarmentUrl(null);
    if (runId) writeRecoveryState({ runId });
  }, [selectedAssetKey]);

  useEffect(() => {
    if (!result) return;
    if (initialRecovery?.runId === result.run_id && initialRecovery.fitPayload) return;
    setGarmentResult(null);
    setGarmentAnalysis(null);
    setGarmentAnalysisAccepted(false);
    setGarmentRotationTurns({ x: 0, y: 0, z: 0 });
    setGarmentUprightConfirmed(false);
    setGarmentFrontConfirmed(false);
    setGarmentLandmarksConfirmed(false);
    setSelected(null);
    setGarmentAnalysisUrl(null);
    if (garmentUrl?.startsWith("blob:")) URL.revokeObjectURL(garmentUrl);
    setGarmentUrl(null);
    setWorkspaceTab("avatar");
    setGarmentPreviewKind("fitted");
    setGarmentError(null);
    setShowGarment(true);
    // Every new run starts clean: rejected facial candidates and the dense
    // 478-point mesh stay hidden until the user explicitly asks for them.
    setVisibleGroups((current) => ({
      ...current,
      face_rejected: false,
      face_detail: false,
      body_head: false,
      internal: false,
      anchor: true,
      garment_anchor: true,
    }));
  }, [result?.run_id]);

  useEffect(() => {
    let mounted = true;
    let subscription = null;
    let removeWorkspaceAuthBridge = () => {};
    async function bootAuth() {
      try {
        const response = await fetch(`${API}/api/clouva/config`);
        const config = await response.json();
        if (!response.ok || !config.supabaseUrl || !config.publishableKey) {
          throw new Error("No se pudo cargar la conexión pública de CLOUVA");
        }
        const client = createClient(config.supabaseUrl, config.publishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: "clouva-anatomy-lab-auth",
          },
        });
        if (!mounted) return;
        setSupabase(client);
        removeWorkspaceAuthBridge = installWorkspaceAuthBridge({
          client,
          onSession: (nextSession) => { if (mounted) setSession(nextSession); },
          onManagedChange: (managed) => { if (mounted) setWorkspaceManagedAuth(managed); },
        });
        const { data } = await client.auth.getSession();
        if (mounted) setSession(data.session || null);
        const listener = client.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession || null);
        });
        subscription = listener.data.subscription;
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : "No se pudo iniciar la conexión");
      } finally {
        if (mounted) setAuthReady(true);
      }
    }
    bootAuth();
    return () => {
      mounted = false;
      subscription?.unsubscribe();
      removeWorkspaceAuthBridge();
    };
  }, []);

  useEffect(() => () => modelUrl && URL.revokeObjectURL(modelUrl), [modelUrl]);

  useEffect(() => {
    if (!runId || modelUrl) return;
    let disposed = false;
    let objectUrl = null;
    async function recoverAnalyzedAvatar() {
      try {
        const response = await fetch(`${API}/api/runs/${runId}/asset/source.glb`);
        if (!response.ok) return;
        const buffer = await response.arrayBuffer();
        if (!hasGlbHeader(buffer)) return;
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
        if (disposed) return;
        setModelUrl(objectUrl);
      } catch {
        // A missing historical source must not prevent a new local analysis.
      }
    }
    void recoverAnalyzedAvatar();
    return () => {
      disposed = true;
      if (objectUrl && !modelUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let disposed = false;
    fetch(`${API}/api/runs/${runId}/result`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!disposed && payload) {
          setResult(payload);
          setProgress({ progress: 100, message: "Análisis completado" });
        }
      })
      .catch(() => {});
    const stream = new EventSource(`${API}/api/runs/${runId}/progress`);
    stream.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      setProgress(data);
      if (data.error) setError(data.error);
      if (data.phase === "completed") {
        stream.close();
        const response = await fetch(`${API}/api/runs/${runId}/result`);
        if (response.ok) setResult(await response.json());
      }
    };
    stream.onerror = () => stream.close();
    return () => {
      disposed = true;
      stream.close();
    };
  }, [runId]);

  useEffect(() => {
    const assetPath = garmentResult?.asset_paths?.glb;
    if (!modelUrl || !runId || !assetPath || garmentUrl) return;
    let disposed = false;
    let objectUrl = null;
    async function recoverFit() {
      try {
        validateFitPayload(garmentResult);
        const response = await fetch(`${API}/api/runs/${runId}/asset/${assetPath}`);
        if (!response.ok) throw new Error("El GLB adaptado guardado ya no está disponible");
        const buffer = await response.arrayBuffer();
        if (!hasGlbHeader(buffer)) throw new Error("El GLB adaptado guardado está incompleto");
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
        if (disposed) return;
        setGarmentUrl(objectUrl);
        setGarmentAnalysis(garmentResult.analysis || null);
        setGarmentAnalysisAccepted(Boolean(garmentResult.analysis?.validation?.accepted));
        setGarmentUprightConfirmed(Boolean(garmentResult.analysis?.validation?.orientation_confirmed));
        setGarmentFrontConfirmed(Boolean(garmentResult.analysis?.validation?.orientation_confirmed));
        setGarmentLandmarksConfirmed(Boolean(garmentResult.analysis?.validation?.landmarks_confirmed));
        if (garmentResult.template?.asset_key) setSelectedAssetKey(garmentResult.template.asset_key);
        setGarmentPreviewKind("fitted");
        setShowGarment(true);
        setWorkspaceTab("result");
        setProgress({ progress: 100, message: "Resultado recuperado" });
      } catch (cause) {
        if (!disposed) setGarmentError(cause instanceof Error ? cause.message : "No se pudo recuperar el fitting");
      }
    }
    void recoverFit();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [modelUrl, runId, garmentResult?.fit_id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || attemptedUserId === userId || clouvaLoading) return;
    setAttemptedUserId(userId);
    loadActiveAvatar(session);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.access_token) {
      setLibraryAssets([]);
      setSelectedAssetKey("");
      return;
    }
    loadLibraryAssets(session);
  }, [session?.access_token]);

  function chooseFile(next, avatarInfo = null, preserveRecovery = false) {
    if (!next || !next.name.toLowerCase().endsWith(".glb")) {
      setError("Elegí un archivo .glb");
      return;
    }
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    setFile(next);
    setModelUrl(URL.createObjectURL(next));
    setActiveAvatar(avatarInfo);
    if (preserveRecovery) return;
    writeRecoveryState(null);
    setRunId(null);
    setResult(null);
    setGarmentResult(null);
    if (garmentUrl?.startsWith("blob:")) URL.revokeObjectURL(garmentUrl);
    setGarmentUrl(null);
    setGarmentPreviewKind("fitted");
    setGarmentError(null);
    setSelected(null);
    setError(null);
    setProgress({
      progress: 0,
      message: avatarInfo ? `Avatar activo cargado: ${avatarInfo.name}` : "Avatar manual listo para analizar",
    });
  }

  async function connectGoogle() {
    if (!supabase) return;
    setAuthBusy(true);
    setError(null);
    setAuthMessage("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
    if (authError) {
      setError(`No se pudo abrir Google: ${authError.message}`);
      setAuthBusy(false);
    }
  }

  async function sendMagicLink() {
    if (!supabase || !email.trim()) {
      setError("Escribí el email de tu cuenta CLOUVA");
      return;
    }
    setAuthBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setAuthBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    setAuthMessage("Te mandamos un enlace. Abrilo en esta misma PC.");
  }

  async function disconnect() {
    if (supabase) await supabase.auth.signOut({ scope: "local" });
    setSession(null);
    setAttemptedUserId(null);
    setActiveAvatar(null);
    setAuthMessage("");
  }

  async function loadActiveAvatar(sessionOverride = session) {
    const accessToken = sessionOverride?.access_token;
    if (!accessToken) {
      setError("Primero conectá tu cuenta CLOUVA");
      return;
    }
    setClouvaLoading(true);
    setError(null);
    setProgress({ progress: 0, message: "Buscando tu avatar activo en CLOUVA…" });
    const headers = { Authorization: `Bearer ${accessToken}` };
    try {
      const metadataResponse = await fetch(`${API}/api/clouva/avatar`, { headers });
      const metadataPayload = await metadataResponse.json();
      if (!metadataResponse.ok) {
        throw new Error(metadataPayload.detail || "No se encontró el avatar activo");
      }
      setProgress({ progress: 0, message: `Descargando ${metadataPayload.name || "avatar activo"}…` });
      const fileResponse = await fetch(`${API}/api/clouva/avatar/file`, { headers });
      if (!fileResponse.ok) {
        const payload = await fileResponse.json().catch(() => ({}));
        throw new Error(payload.detail || "No se pudo descargar el GLB de CLOUVA");
      }
      const blob = await fileResponse.blob();
      const safeName = String(metadataPayload.name || "avatar-activo")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "avatar-activo";
      const nextFile = new File([blob], `${safeName}.glb`, { type: "model/gltf-binary" });
      chooseFile(nextFile, metadataPayload, Boolean(readRecoveryState()?.runId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el avatar de CLOUVA");
      setProgress({ progress: 0, message: "No se pudo cargar el avatar activo" });
    } finally {
      setClouvaLoading(false);
    }
  }

  async function analyze() {
    if (!file) {
      setError("Primero cargá el avatar activo o elegí un GLB");
      return;
    }
    setError(null);
    setResult(null);
    setGarmentResult(null);
    if (garmentUrl?.startsWith("blob:")) URL.revokeObjectURL(garmentUrl);
    setGarmentUrl(null);
    setGarmentPreviewKind("fitted");
    setGarmentError(null);
    setSelected(null);
    writeRecoveryState(null);
    const body = new FormData();
    body.append("file", file);
    body.append("height_cm", String(heightCm));
    const response = await fetch(`${API}/api/analyze`, { method: "POST", body });
    const data = await response.json();
    if (!response.ok) {
      setError(data.detail || "No se pudo iniciar");
      return;
    }
    setRunId(data.runId);
    writeRecoveryState({ runId: data.runId });
    setProgress({ progress: 1, message: "Iniciando…" });
  }

  async function cancel() {
    if (runId) await fetch(`${API}/api/runs/${runId}/cancel`, { method: "POST" });
  }

  async function loadLibraryAssets(sessionOverride = session) {
    const accessToken = sessionOverride?.access_token;
    if (!accessToken) return;
    setLibraryBusy(true);
    setGarmentError(null);
    try {
      const response = await fetch(`${API}/api/library/assets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo leer la Biblioteca CLOUVA");
      const items = Array.isArray(payload.assets) ? payload.assets : [];
      setLibraryAssets(items);
      const currentStillExists = items.some((item) => item.asset_key === selectedAssetKey);
      if (!currentStillExists) {
        const preferred = items.find((item) => item.official_code === "r1") || items.find((item) => item.fit_supported) || items[0];
        setSelectedAssetKey(preferred?.asset_key || "");
      }
    } catch (cause) {
      setLibraryAssets([]);
      setSelectedAssetKey("");
      setGarmentError(cause instanceof Error ? cause.message : "No se pudo leer la Biblioteca CLOUVA");
    } finally {
      setLibraryBusy(false);
    }
  }

  async function fetchSelectedLibraryBlob() {
    if (!session?.access_token || !selectedLibraryAsset) {
      throw new Error("Elegí un GLB de la biblioteca");
    }
    const response = await fetch(`${API}/api/library/asset-file?asset_key=${encodeURIComponent(selectedLibraryAsset.asset_key)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "No se pudo descargar el GLB seleccionado");
    }
    return response.blob();
  }

  async function analyzeSelectedLibraryAsset() {
    if (!runId || !result?.readiness?.garment_mold_input_ready) {
      setGarmentError("Primero completá el análisis anatómico del avatar");
      return;
    }
    if (!session?.access_token || !selectedLibraryAsset) {
      setGarmentError("Conectá tu cuenta y elegí un GLB de la biblioteca");
      return;
    }
    setGarmentBusy(true);
    setGarmentError(null);
    try {
      const body = new FormData();
      body.append("asset_key", selectedLibraryAsset.asset_key);
      const response = await fetch(`${API}/api/runs/${runId}/analyze-library-asset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo analizar el GLB seleccionado");
      if (payload.version !== REQUIRED_GARMENT_ANALYSIS_VERSION) {
        throw new Error(`Backend desactualizado: devolvió ${payload.version || "sin versión"}. Cerrá Anatomy Lab, ejecutá REPARAR_V1360_REAL.bat y volvé a iniciar.`);
      }
      setGarmentAnalysis(payload);
      setGarmentAnalysisAccepted(Boolean(payload.readiness?.analysis_accepted));
      setGarmentRotationTurns({ x: 0, y: 0, z: 0 });
      setGarmentUprightConfirmed(Boolean(payload.validation?.orientation_confirmed));
      setGarmentFrontConfirmed(Boolean(payload.validation?.orientation_confirmed));
      setGarmentLandmarksConfirmed(Boolean(payload.validation?.landmarks_confirmed));
      setSelected(null);
      setGarmentResult(null);
      setGarmentAnalysisUrl(`${API}/api/runs/${runId}/asset/${payload.asset_paths.glb}?v=${Date.now()}`);
      setGarmentUrl(null);
      setGarmentPreviewKind("analysis");
      setShowGarment(true);
      setWorkspaceTab("garment");
    } catch (cause) {
      setGarmentError(cause instanceof Error ? cause.message : "No se pudo analizar el GLB");
    } finally {
      setGarmentBusy(false);
    }
  }

  async function acceptGarmentAnalysis() {
    if (!runId || !garmentAnalysis?.analysis_id || !selectedLibraryAsset || !session?.access_token) {
      setGarmentError("Primero analizá la prenda en el visor separado");
      return;
    }
    if (garmentAnalysis.version !== REQUIRED_GARMENT_ANALYSIS_VERSION) {
      setGarmentError(`No se puede aceptar un análisis viejo (${garmentAnalysis.version || "sin versión"}). Reanalizá después de instalar ${APP_VERSION}.`);
      return;
    }
    if (!garmentUprightConfirmed || !garmentFrontConfirmed || !garmentLandmarksConfirmed) {
      setGarmentError("Confirmá arriba, frente/espalda y landmarks antes de aceptar");
      return;
    }
    const reviewWidth = Number(garmentAnalysis.measurements_relative?.width || 0);
    const reviewDepth = Number(garmentAnalysis.measurements_relative?.depth || 0);
    const reviewHeight = Number(garmentAnalysis.measurements_relative?.height || 0);
    if ([reviewWidth, reviewDepth, reviewHeight].some((value) => !Number.isFinite(value) || value <= 0) || reviewDepth >= reviewHeight) {
      setGarmentError("El análisis actual tiene alto y profundidad cruzados. Tocá Reanalizar prenda antes de aceptar.");
      return;
    }
    if (Number(garmentRotationTurns.x || 0) % 4 !== 0 || Number(garmentRotationTurns.y || 0) % 4 !== 0 || ![0, 2].includes(Number(garmentRotationTurns.z || 0) % 4)) {
      setGarmentError("La revisión solo permite frente original o frente invertido 180°.");
      return;
    }
    setGarmentBusy(true);
    setGarmentError(null);
    try {
      const body = new FormData();
      body.append("asset_key", selectedLibraryAsset.asset_key);
      body.append("analysis_id", garmentAnalysis.analysis_id);
      body.append("quarter_turns", String(garmentRotationTurns.z || 0));
      body.append("rotation_x_quarter_turns", String(garmentRotationTurns.x || 0));
      body.append("rotation_y_quarter_turns", String(garmentRotationTurns.y || 0));
      body.append("rotation_z_quarter_turns", String(garmentRotationTurns.z || 0));
      body.append("orientation_confirmed", String(garmentUprightConfirmed && garmentFrontConfirmed));
      body.append("landmarks_confirmed", String(garmentLandmarksConfirmed));
      const response = await fetch(`${API}/api/runs/${runId}/accept-garment-analysis`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo aceptar el análisis");
      if (payload.version !== REQUIRED_GARMENT_ANALYSIS_VERSION) {
        throw new Error(`El backend aceptó con una versión vieja (${payload.version || "sin versión"}). La aceptación fue bloqueada.`);
      }
      const acceptedDepth = Number(payload.measurements_relative?.depth || 0);
      const acceptedHeight = Number(payload.measurements_relative?.height || 0);
      if (!Number.isFinite(acceptedDepth) || !Number.isFinite(acceptedHeight) || acceptedDepth >= acceptedHeight) {
        throw new Error("El backend devolvió una orientación inválida y fue bloqueada. Reanalizá la prenda.");
      }
      setGarmentAnalysis(payload);
      setGarmentAnalysisAccepted(true);
      setGarmentRotationTurns({ x: 0, y: 0, z: 0 });
      setGarmentUprightConfirmed(true);
      setGarmentFrontConfirmed(true);
      setGarmentLandmarksConfirmed(true);
      setGarmentAnalysisUrl(`${API}/api/runs/${runId}/asset/${payload.asset_paths.glb}?v=${Date.now()}`);
      setWorkspaceTab("garment");
    } catch (cause) {
      setGarmentError(cause instanceof Error ? cause.message : "No se pudo aceptar el análisis");
    } finally {
      setGarmentBusy(false);
    }
  }

  async function previewSelectedLibraryAsset() {
    if (!runId || !result?.readiness?.garment_mold_input_ready) {
      setGarmentError("Primero completá el análisis anatómico para alinear la prenda al torso");
      return;
    }
    if (!session?.access_token || !selectedLibraryAsset) {
      setGarmentError("Conectá tu cuenta y elegí un GLB de la biblioteca");
      return;
    }
    setGarmentBusy(true);
    setGarmentError(null);
    try {
      const body = new FormData();
      body.append("asset_key", selectedLibraryAsset.asset_key);
      body.append("fit_mode", garmentFit === "relaxed" ? "regular" : garmentFit);
      const response = await fetch(`${API}/api/runs/${runId}/preview-library-asset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo autoalinear el GLB seleccionado");
      if (garmentUrl?.startsWith("blob:")) URL.revokeObjectURL(garmentUrl);
      setGarmentResult(payload);
      setGarmentUrl(`${API}/api/runs/${runId}/asset/${payload.asset_paths.glb}?v=${Date.now()}`);
      setGarmentPreviewKind("library");
      setShowGarment(true);
    } catch (cause) {
      setGarmentError(cause instanceof Error ? cause.message : "No se pudo autoalinear el GLB");
    } finally {
      setGarmentBusy(false);
    }
  }

  async function downloadSelectedLibraryAsset() {
    setGarmentError(null);
    try {
      const blob = await fetchSelectedLibraryBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = selectedLibraryAsset?.file_name || `${selectedLibraryAsset?.code || "library-asset"}.glb`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setGarmentError(cause instanceof Error ? cause.message : "No se pudo descargar el GLB");
    }
  }

  async function fitSelectedLibraryAsset() {
    if (!runId || !result?.readiness?.garment_mold_input_ready) {
      setGarmentError("Primero completá el análisis anatómico del avatar");
      return;
    }
    if (!session?.access_token || !selectedLibraryAsset) {
      setGarmentError("Conectá tu cuenta y elegí un GLB de la biblioteca");
      return;
    }
    setGarmentBusy(true);
    setGarmentError(null);
    try {
      const body = new FormData();
      body.append("asset_key", selectedLibraryAsset.asset_key);
      body.append("fit_mode", garmentFit === "relaxed" ? "regular" : garmentFit);
      const response = await fetch(`${API}/api/runs/${runId}/fit-library-asset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo ajustar el GLB seleccionado");
      const assetPath = validateFitPayload(payload);
      const assetResponse = await fetch(`${API}/api/runs/${runId}/asset/${assetPath}`);
      if (!assetResponse.ok) throw new Error("El GLB adaptado no quedó disponible para el visor");
      const assetBuffer = await assetResponse.arrayBuffer();
      if (!hasGlbHeader(assetBuffer)) throw new Error("El archivo adaptado no es un GLB completo");
      const nextGarmentUrl = URL.createObjectURL(new Blob([assetBuffer], { type: "model/gltf-binary" }));
      writeRecoveryState({ runId, fitPayload: payload });
      if (garmentUrl?.startsWith("blob:")) URL.revokeObjectURL(garmentUrl);
      setGarmentResult(payload);
      setGarmentAnalysis(payload.analysis || garmentAnalysis);
      setGarmentUrl(nextGarmentUrl);
      setGarmentPreviewKind("fitted");
      setShowGarment(true);
      setWorkspaceTab("result");
    } catch (cause) {
      setGarmentError(cause instanceof Error ? cause.message : "No se pudo ajustar el GLB seleccionado");
    } finally {
      setGarmentBusy(false);
    }
  }

  async function generateGarmentMold() {
    if (!runId || !result?.readiness?.garment_mold_input_ready) {
      setGarmentError("La base final del molde todavia no esta lista");
      return;
    }
    setGarmentBusy(true);
    setGarmentError(null);
    try {
      const response = await fetch(`${API}/api/runs/${runId}/garment-mold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fit: garmentFit }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo generar el molde");
      if (garmentUrl?.startsWith("blob:")) URL.revokeObjectURL(garmentUrl);
      setGarmentResult(payload);
      setGarmentUrl(`${API}/api/runs/${runId}/asset/${payload.assets.glb}?v=${Date.now()}`);
      setGarmentPreviewKind("fitted");
      setShowGarment(true);
    } catch (cause) {
      setGarmentError(cause instanceof Error ? cause.message : "No se pudo generar el molde");
    } finally {
      setGarmentBusy(false);
    }
  }

  async function downloadAsset(path, filename) {
    if (!path || !runId) return;
    const response = await fetch(`${API}/api/runs/${runId}/asset/${path}`);
    if (!response.ok) {
      setGarmentError("No se pudo descargar el archivo del molde");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${runId || "anatomy"}-result.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const garmentSummary = summarizeGarmentResult(garmentResult);

  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">CLOUVA</span>
          <h1>Anatomy Lab Local <small style={{ opacity: 0.45, fontSize: "0.45em", verticalAlign: "middle" }}>{APP_VERSION}</small></h1>
        </div>
        <div className="status">
          <span>{progress.message}</span>
          <strong>{progress.progress || 0}%</strong>
        </div>
      </header>

      <section className="workspace">
        <aside className="left panel">
          <h3>Tu cuenta CLOUVA</h3>
          <div className="auth-card">
            {!authReady ? (
              <p className="muted">Preparando conexión…</p>
            ) : session ? (
              <>
                <div className="connected-row">
                  <span className="connected-dot" />
                  <div>
                    <b>Cuenta conectada</b>
                    <small>{session.user?.email || "Usuario CLOUVA"}</small>
                  </div>
                </div>
                {activeAvatar && (
                  <div className="avatar-source">
                    <span>Avatar activo</span>
                    <b>{activeAvatar.name}</b>
                    <small>{activeAvatar.sourceKind || "CLOUVA"}</small>
                  </div>
                )}
                <button className="primary" onClick={() => loadActiveAvatar()} disabled={clouvaLoading}>
                  {clouvaLoading ? "Cargando avatar…" : activeAvatar ? "Recargar avatar activo" : "Cargar avatar activo"}
                </button>
                {workspaceManagedAuth
                  ? <small className="local-note">Sesión administrada por CLOUVA Workspace.</small>
                  : <button className="small-button" onClick={disconnect}>Cerrar sesión local</button>}
              </>
            ) : (
              <>
                <p className="auth-copy">Entrá una vez para que el laboratorio lea tu avatar activo de la app.</p>
                <button className="primary" onClick={connectGoogle} disabled={!supabase || authBusy}>
                  Conectar con CLOUVA
                </button>
                <div className="auth-divider"><span>o por email</span></div>
                <input
                  className="email-input"
                  type="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <button onClick={sendMagicLink} disabled={!supabase || authBusy}>Mandar enlace de acceso</button>
                <small className="local-note">La sesión queda solamente en localhost.</small>
              </>
            )}
            {authMessage && <p className="success-message">{authMessage}</p>}
          </div>

          <h3>GLB alternativo</h3>
          <label
            className="drop compact"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              type="file"
              accept=".glb,model/gltf-binary"
              onChange={(event) => chooseFile(event.target.files[0])}
            />
            <strong>{file ? file.name : "Cargar GLB manual"}</strong>
            <span>solo como alternativa</span>
          </label>

          <label className="height-field">
            <span>Altura real del avatar (cm)</span>
            <input
              type="number"
              min="80"
              max="250"
              step="0.5"
              value={heightCm}
              onChange={(event) => setHeightCm(Number(event.target.value || 180))}
            />
            <small>Se usa para convertir la geometría a centímetros reales.</small>
          </label>

          <button
            className="primary analyze-button"
            onClick={analyze}
            disabled={!file || Boolean(runId && progress.progress < 100)}
          >
            Analizar avatar
          </button>
          <button onClick={cancel} disabled={!runId || progress.progress >= 100}>Cancelar</button>
          <button onClick={downloadJson} disabled={!result}>Descargar JSON</button>

          <div className="garment-card">
            <h3>Garment Review v1.3.6 · Eje vertical bloqueado</h3>
            <p className="garment-copy">Primero analizá la prenda sola. Aceptá el diagnóstico recién cuando orientación, cuello, hombros y medidas se vean bien. Después se habilita el fitting contra el avatar.</p>

            <div className="pipeline-steps">
              <span className={selectedLibraryAsset ? "done" : ""}>1 · GLB</span>
              <span className={garmentAnalysis ? "done" : ""}>2 · Análisis</span>
              <span className={garmentAnalysisAccepted ? "done" : ""}>3 · Validado</span>
              <span className={garmentResult?.fit ? "done" : ""}>4 · Fit</span>
            </div>

            <label className="fit-field">
              <span>Buscar GLB</span>
              <input className="email-input" type="text" placeholder="Nombre, archivo o categoría…" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} disabled={!session || libraryBusy} />
            </label>

            <label className="fit-field">
              <span>Categoría</span>
              <select value={libraryCategory} onChange={(event) => setLibraryCategory(event.target.value)} disabled={!session || libraryBusy}>
                {libraryCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>

            <label className="fit-field">
              <span>GLB seleccionado ({filteredLibraryAssets.length}/{libraryAssets.length})</span>
              <select value={selectedAssetKey} onChange={(event) => setSelectedAssetKey(event.target.value)} disabled={!session || libraryBusy || filteredLibraryAssets.length === 0}>
                {filteredLibraryAssets.length === 0 ? (
                  <option value="">{libraryBusy ? "Leyendo biblioteca…" : session ? "No hay resultados" : "Conectá CLOUVA"}</option>
                ) : filteredLibraryAssets.map((item) => (
                  <option key={item.asset_key} value={item.asset_key}>{item.official_template ? "★ " : ""}{item.name} — {item.category_label}</option>
                ))}
              </select>
            </label>

            {selectedLibraryAsset && (
              <div className="avatar-source">
                <span>{selectedLibraryAsset.source_label}</span>
                <b>{selectedLibraryAsset.name}</b>
                <small>{selectedLibraryAsset.official_template ? "Template oficial · " : ""}Análisis separado disponible</small>
              </div>
            )}

            <button className="primary" onClick={analyzeSelectedLibraryAsset} disabled={!selectedLibraryAsset || garmentBusy || !result?.readiness?.garment_mold_input_ready}>
              {garmentBusy ? "Procesando prenda…" : garmentAnalysis ? "Reanalizar prenda" : "Analizar prenda"}
            </button>

            {garmentAnalysis?.classification && (
              <div className={`analysis-summary status-${garmentAnalysis.analysis_status || "doubtful"}`}>
                <div><span>Estado</span><b>{garmentAnalysis.analysis_status === "ok" ? "OK" : garmentAnalysis.analysis_status === "incomplete" ? "Incompleto" : "Dudoso"}</b></div>
                <div><span>Tipo</span><b>{garmentAnalysis.classification.category}</b></div>
                <div><span>Confianza</span><b>{Math.round((garmentAnalysis.classification.confidence || 0) * 100)}%</b></div>
                <div><span>Malla</span><b>{garmentAnalysis.geometry?.vertex_count || 0} vértices</b></div>
              </div>
            )}

            {garmentAnalysis && (
              <>
                <button onClick={() => setWorkspaceTab("garment")}>Ver análisis de la prenda</button>
                <div className="orientation-editor">
                  <div className="orientation-editor-head">
                    <strong>Revisión de frente y espalda</strong>
                    <span>{Number(garmentRotationTurns.z || 0) % 4 === 2 ? "Frente invertido 180°" : "Frente original"}</span>
                  </div>
                  <p className="orientation-help">La altura queda bloqueada por el analizador. Rotá la cámara para inspeccionar; no inclines la prenda. Este control solo invierte frente y espalda alrededor del eje Z.</p>
                  <div className="analysis-actions orientation-shortcuts">
                    <button onClick={() => {
                      setGarmentRotationTurns((current) => ({ x: 0, y: 0, z: Number(current.z || 0) % 4 === 2 ? 0 : 2 }));
                      setGarmentFrontConfirmed(false);
                      setGarmentLandmarksConfirmed(false);
                    }} disabled={garmentAnalysisAccepted}>Dar vuelta frente/espalda</button>
                    <button onClick={() => {
                      setGarmentRotationTurns({ x: 0, y: 0, z: 0 });
                      setGarmentUprightConfirmed(false);
                      setGarmentFrontConfirmed(false);
                      setGarmentLandmarksConfirmed(false);
                    }} disabled={garmentAnalysisAccepted}>Restablecer frente original</button>
                  </div>
                </div>
                <div className="analysis-review-gates">
                  <label><input type="checkbox" checked={garmentUprightConfirmed} onChange={(event) => setGarmentUprightConfirmed(event.target.checked)} disabled={garmentAnalysisAccepted} /> Arriba correcto</label>
                  <label><input type="checkbox" checked={garmentFrontConfirmed} onChange={(event) => setGarmentFrontConfirmed(event.target.checked)} disabled={garmentAnalysisAccepted} /> Frente y espalda correctos</label>
                  <label><input type="checkbox" checked={garmentLandmarksConfirmed} onChange={(event) => setGarmentLandmarksConfirmed(event.target.checked)} disabled={garmentAnalysisAccepted} /> Cuello, hombros y landmarks revisados</label>
                </div>
                <button className="primary accept-analysis" onClick={acceptGarmentAnalysis} disabled={garmentBusy || garmentAnalysisAccepted || !garmentUprightConfirmed || !garmentFrontConfirmed || !garmentLandmarksConfirmed}>
                  {garmentAnalysisAccepted ? "Análisis aceptado ✓" : "Aceptar análisis revisado"}
                </button>
              </>
            )}

            <button onClick={downloadSelectedLibraryAsset} disabled={!selectedLibraryAsset || garmentBusy}>Descargar GLB original</button>

            <label className="fit-field">
              <span>Calce para adaptar</span>
              <select value={garmentFit} onChange={(event) => setGarmentFit(event.target.value)}>
                <option value="base">Base</option>
                <option value="regular">Regular</option>
                <option value="oversized">Oversized</option>
              </select>
            </label>
            <button className="primary mold-button" onClick={fitSelectedLibraryAsset} disabled={!result?.readiness?.garment_mold_input_ready || garmentBusy || !selectedLibraryAsset || !garmentAnalysisAccepted}>
              {garmentBusy ? "Adaptando prenda…" : garmentAnalysisAccepted ? "Adaptar al avatar" : "Aceptá el análisis para adaptar"}
            </button>
            <button onClick={() => loadLibraryAssets()} disabled={!session || libraryBusy}>{libraryBusy ? "Actualizando biblioteca…" : "Recargar biblioteca completa"}</button>

            {garmentAnalysis?.asset_paths?.analysis_json && (
              <button onClick={() => downloadAsset(garmentAnalysis.asset_paths.analysis_json, garmentAnalysisAccepted ? "garment_analysis_accepted.json" : "garment_analysis.json")}>Descargar análisis JSON</button>
            )}
            {garmentResult?.asset_paths?.glb && (
              <button onClick={() => downloadAsset(garmentResult.asset_paths.glb, `${garmentResult.template?.code || "garment"}_fitted.glb`)}>Descargar GLB adaptado</button>
            )}
            {garmentResult?.asset_paths?.fit_json && <button onClick={() => downloadAsset(garmentResult.asset_paths.fit_json, "garment_fit.json")}>Descargar fit JSON</button>}
            {garmentResult?.asset_paths?.collision_json && <button onClick={() => downloadAsset(garmentResult.asset_paths.collision_json, "garment_collision_report.json")}>Descargar colisiones</button>}
            {garmentError && <p className="error">{garmentError}</p>}
          </div>

          <div className="progress"><div style={{ width: `${progress.progress || 0}%` }} /></div>

          {error && <p className="error">{error}</p>}

          <h3>Capas</h3>
          {Object.keys(visibleGroups).map((group) => (
            <label className="toggle" key={group}>
              <input
                type="checkbox"
                checked={visibleGroups[group]}
                onChange={(event) => setVisibleGroups({ ...visibleGroups, [group]: event.target.checked })}
              />
              <span>
                {group === "body" ? "Cuerpo"
                  : group === "body_head" ? "Pose facial corporal (diagnóstico)"
                  : group === "face" ? "Rasgos faciales clave"
                  : group === "face_detail" ? "Malla facial completa (478)"
                  : group === "face_rejected" ? "Faciales rechazados"
                  : group === "hand" ? "Manos y dedos"
                  : group === "anchor" ? "Pines exactos de lóbulos"
                  : group === "garment_anchor" ? "Puntos de confección"
                  : "Articulaciones internas"}
              </span>
            </label>
          ))}

          {result && (
            <div className="metrics">
              <b>{result.version || "sin versión"}</b><span>motor del análisis</span>
              <b>{result.metrics?.surface_landmark_count || 0}</b><span>landmarks proyectados</span>
              <b>{result.source?.triangle_count || 0}</b><span>triángulos del GLB</span>
              <b>{result.face_validation?.metrics?.validated_face_landmarks || 0}</b><span>faciales válidos</span>
              <b>{result.face_validation?.metrics?.rejected_face_landmarks || 0}</b><span>faciales rechazados</span>
              <b>{result.metrics?.earring_anchor_count || 0}</b><span>anclajes para aritos</span>
              <b>{result.metrics?.measurement_count || 0}</b><span>medidas calculadas</span>
              <b>{result.metrics?.garment_anchor_count || 0}</b><span>puntos de confección</span>
            </div>
          )}
        </aside>

        <div className="viewer">
          <div className="viewer-tabs">
            <button className={workspaceTab === "avatar" ? "active" : ""} onClick={() => setWorkspaceTab("avatar")}>Avatar</button>
            <button className={workspaceTab === "garment" ? "active" : ""} onClick={() => setWorkspaceTab("garment")} disabled={!garmentAnalysisUrl}>Prenda</button>
            <button className={workspaceTab === "result" ? "active" : ""} onClick={() => setWorkspaceTab("result")} disabled={!garmentUrl}>Resultado</button>
          </div>
          {workspaceTab === "garment" ? (
            <>
              <GarmentStandaloneViewer
                url={garmentAnalysisUrl}
                analysis={garmentAnalysis}
                rotationTurns={garmentRotationTurns}
                wireframe={garmentWireframe}
                showLandmarks={showGarmentLandmarks}
                showBounds={showGarmentBounds}
                showAxes={showGarmentAxes}
                selectedLandmark={selected}
                onSelectLandmark={setSelected}
              />
              <div className="garment-view-controls">
                <label><input type="checkbox" checked={garmentWireframe} onChange={(event) => setGarmentWireframe(event.target.checked)} /> Wireframe</label>
                <label><input type="checkbox" checked={showGarmentLandmarks} onChange={(event) => setShowGarmentLandmarks(event.target.checked)} /> Landmarks</label>
                <label><input type="checkbox" checked={showGarmentBounds} onChange={(event) => setShowGarmentBounds(event.target.checked)} /> Bounds</label>
                <label><input type="checkbox" checked={showGarmentAxes} onChange={(event) => setShowGarmentAxes(event.target.checked)} /> Ejes/pivote</label>
              </div>
            </>
          ) : (
            <ViewerErrorBoundary
              resetKey={`${workspaceTab}:${modelUrl || ""}:${garmentUrl || ""}`}
              onReset={() => {
                if (garmentUrl) useGLTF.clear(garmentUrl);
                setShowGarment(false);
                setWorkspaceTab("avatar");
              }}
            >
              <Viewer
                modelUrl={modelUrl}
                garmentUrl={workspaceTab === "result" ? garmentUrl : null}
                garmentPreviewKind={garmentPreviewKind}
                showGarment={workspaceTab === "result" && showGarment}
                result={result}
                visibleGroups={visibleGroups}
                selected={selected}
                onSelect={setSelected}
              />
            </ViewerErrorBoundary>
          )}
        </div>

        <aside className="right panel">
          <h3>Punto seleccionado</h3>
          {selected ? (
            <dl>
              <dt>Nombre</dt><dd>{selected.name}</dd>
              <dt>Grupo</dt><dd>{selected.group}</dd>
              {selected.category && <><dt>Categoría</dt><dd>{selected.category}</dd></>}
              {selected.side && <><dt>Lado</dt><dd>{selected.side}</dd></>}
              <dt>Estado</dt><dd>{selected.state}</dd>
              <dt>Confianza</dt><dd>{Math.round((selected.confidence || 0) * 100)}%</dd>
              <dt>Triángulo</dt><dd>{selected.triangle_id}</dd>
              <dt>Mesh</dt><dd>{selected.mesh_id ?? "prenda"}</dd>
              {selected.vertex_index !== undefined && <><dt>Vértice superficie</dt><dd>{selected.vertex_index}</dd></>}
              {selected.source_surface_vertex_index !== undefined && <><dt>Vértice de referencia</dt><dd>{selected.source_surface_vertex_index}</dd></>}
              {selected.method && <><dt>Método</dt><dd>{selected.method}</dd></>}
              {selected.distance_normalized !== undefined && <><dt>Distancia normalizada</dt><dd>{Number(selected.distance_normalized).toFixed(4)}</dd></>}
              {selected.midpoint_depth !== undefined && <><dt>Centro de profundidad</dt><dd>{Number(selected.midpoint_depth).toFixed(4)}</dd></>}
              {selected.depth_span !== undefined && <><dt>Espesor local</dt><dd>{Number(selected.depth_span).toFixed(4)}</dd></>}
              {selected.sample_count !== undefined && <><dt>Muestras locales</dt><dd>{selected.sample_count}</dd></>}
              <dt>Baricéntricas</dt><dd>{selected.barycentric?.map((n) => n.toFixed(4)).join(", ")}</dd>
              <dt>Vistas</dt><dd>{selected.confirmed_views?.join(", ")}</dd>
              {selected.rejection_reason && <><dt>Motivo</dt><dd>{selected.rejection_reason}</dd></>}
              {selected.validation?.projected_y !== undefined && <><dt>Profundidad facial</dt><dd>{selected.validation.projected_y.toFixed(4)}</dd></>}
            </dl>
          ) : (
            <p className="muted">Tocá un punto para inspeccionarlo.</p>
          )}

          {workspaceTab === "garment" && garmentAnalysis && (
            <>
              <h3>Diagnóstico de prenda</h3>
              <div className="measurement-list">
                <div><span>Estado</span><b>{garmentAnalysisAccepted ? "Aceptado" : garmentAnalysis.analysis_status || "dudoso"}</b></div>
                <div><span>Categoría</span><b>{garmentAnalysis.classification?.category || "unknown"}</b></div>
                <div><span>Orientación</span><b>{Math.round((garmentAnalysis.orientation?.confidence || 0) * 100)}%</b></div>
                <div><span>Ancho</span><b>{Number(garmentAnalysis.measurements_relative?.width || 0).toFixed(3)}</b></div>
                <div><span>Alto</span><b>{Number(garmentAnalysis.measurements_relative?.height || 0).toFixed(3)}</b></div>
                <div><span>Profundidad</span><b>{Number(garmentAnalysis.measurements_relative?.depth || 0).toFixed(3)}</b></div>
                <div><span>Landmarks superficie</span><b>{garmentAnalysis.landmark_diagnostics?.surface_locked_count ?? 0}</b></div>
                <div><span>Eje estructural interno</span><b>{garmentAnalysis.landmark_diagnostics?.structural_internal_count ?? 0}</b></div>
                <div><span>Componentes</span><b>{garmentAnalysis.geometry?.connected_components_effective ?? garmentAnalysis.geometry?.connected_components ?? 0} útiles · {garmentAnalysis.geometry?.connected_components_raw ?? garmentAnalysis.geometry?.connected_components ?? 0} crudos</b></div>
                <div><span>Empate orientación</span><b className={garmentAnalysis.orientation?.ambiguous ? "bad" : "ok"}>{garmentAnalysis.orientation?.ambiguous ? "Sí · revisar" : "No"}</b></div>
              </div>
              <p className="muted">Revisá la prenda sola. El fitting queda bloqueado hasta aceptar este análisis.</p>
            </>
          )}

          {result && (
            <>
              <h3>Preparación</h3>
              <ul className="readiness">
                {Object.entries(result.readiness || {}).map(([key, value]) => (
                  <li key={key}>
                    <span>{READINESS_LABELS[key] || key.replaceAll("_", " ")}</span>
                    <b className={value ? "ok" : "bad"}>{value ? "Sí" : "No"}</b>
                  </li>
                ))}
              </ul>

              <h3>Medidas principales</h3>
              <div className="measurement-list">
                {Object.entries(result.body_measurements?.values || {})
                  .filter(([, item]) => item?.value_cm !== undefined)
                  .slice(0, 16)
                  .map(([name, item]) => (
                    <div key={name}>
                      <span>{name.replaceAll("_", " ")}</span>
                      <b className={String(item.status || "").startsWith("invalid") ? "bad" : ""}>
                        {Number(item.value_cm).toFixed(1)} cm
                        {item.symmetry_corrected ? " · corregida" : ""}
                      </b>
                    </div>
                  ))}
              </div>


              {result.body_measurements?.quality?.critical_errors?.length > 0 && (
                <>
                  <h3>Alertas de medidas</h3>
                  <div className="measurement-warnings">
                    {result.body_measurements.quality.critical_errors.map((item, index) => (
                      <p className="error" key={`${item.code}-${index}`}>
                        {item.code}: {(item.measurement || item.pair?.join(" / ") || "revisar medición")}
                      </p>
                    ))}
                  </div>
                </>
              )}

              {garmentResult && (
                <>
                  <h3>Plantilla ajustada</h3>
                  <div className="garment-summary">
                    <div><span>Plantilla</span><b>{garmentResult.template?.code?.toUpperCase() || "-"}</b></div>
                    <div><span>Tipo</span><b>{garmentResult.garment_type || garmentResult.template?.category || "-"}</b></div>
                    <div><span>Calce</span><b>{garmentSummary.fitMode}</b></div>
                    <div><span>Vértices</span><b>{garmentSummary.vertexCount}</b></div>
                    <div><span>Triángulos</span><b>{garmentSummary.triangleCount}</b></div>
                    <div><span>Biblioteca real</span><b className={garmentSummary.libraryConnected ? "ok" : "bad"}>{garmentSummary.libraryConnected ? "Sí" : "No"}</b></div>
                    <div><span>Autoalineado</span><b className={garmentSummary.autoAligned ? "ok" : "bad"}>{garmentSummary.autoAligned ? "Sí" : "No"}</b></div>
                    <div><span>Preview</span><b className={garmentSummary.previewReady ? "ok" : "bad"}>{garmentSummary.previewReady ? "Sí" : "No"}</b></div>
                    <div><span>Clearance mínimo</span><b>{garmentSummary.clearanceMinimumCm === null ? "-" : `${garmentSummary.clearanceMinimumCm.toFixed(2)} cm`}</b></div>
                    <div><span>Salida final</span><b className={garmentSummary.finalOutputReady ? "ok" : "bad"}>{garmentSummary.finalOutputReady ? "Sí" : "No"}</b></div>
                  </div>
                </>
              )}

              <h3>Renders técnicos</h3>
              <div className="renders">
                {(result.renders || []).slice(0, 12).map((path) => (
                  <a href={`${API}/api/runs/${runId}/asset/${path}`} target="_blank" rel="noreferrer" key={path}>
                    {path.split("/").pop()}
                  </a>
                ))}
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <ApplicationErrorBoundary>
    <App />
  </ApplicationErrorBoundary>
);
