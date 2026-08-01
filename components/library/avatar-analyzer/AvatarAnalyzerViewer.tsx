"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import "./hologram-material";
import {
  computeStageBoundingBox,
  frameCameraDistance,
  boundingBoxCenter,
  getLandmarkPosition,
  getLandmarkVisualState,
  landmarkGroup,
  STAGE_FILL_RATIO,
  VISUAL_STATE_LEGEND,
  type BoundingBox,
} from "./view-model";
import type { LandmarkRecord, StageKey } from "./types";
import styles from "./avatar-analyzer-viewer.module.css";

type SurfacePick = { point: number[]; normal: number[] | null };

export type AvatarAnalyzerViewerProps = {
  glbUrl: string | null;
  landmarks: Record<string, LandmarkRecord>;
  stage: StageKey | "todos";
  dimensions?: { boundingBoxMin?: number[]; boundingBoxMax?: number[] };
  showLandmarks?: boolean;
  showSkeleton?: boolean;
  showWireframe?: boolean;
  showLabels?: boolean;
  selectedName?: string | null;
  onSelectLandmark?: (name: string) => void;
  pickMode?: boolean;
  onSurfacePick?: (pick: SurfacePick) => void;
  /** Se incrementa para forzar un reencuadre aunque la etapa no cambie (p. ej. tras seleccionar un landmark distinto). */
  focusToken?: number;
  /** Bbox puntual (landmark seleccionado ± margen) que reemplaza el encuadre de toda la etapa. */
  focusOverride?: BoundingBox | null;
  className?: string;
  emptyLabel?: string;
};

function HologramMesh({ mesh, showWireframe }: { mesh: THREE.Mesh; showWireframe: boolean }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  useFrame((state) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <group>
      <mesh geometry={mesh.geometry} position={mesh.position} rotation={mesh.rotation} scale={mesh.scale}>
        <hologramMaterial
          ref={materialRef}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {showWireframe ? (
        <mesh geometry={mesh.geometry} position={mesh.position} rotation={mesh.rotation} scale={mesh.scale}>
          <meshBasicMaterial color="#8fd6ff" wireframe transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function AvatarScene({ url, showWireframe, showSkeleton }: { url: string; showWireframe: boolean; showSkeleton: boolean }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => cloneSkeleton(gltf.scene) as THREE.Object3D, [gltf.scene]);

  const meshes: THREE.Mesh[] = [];
  let skinnedRoot: THREE.SkinnedMesh | null = null;
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshes.push(child as THREE.Mesh);
      if ((child as THREE.SkinnedMesh).isSkinnedMesh && !skinnedRoot) skinnedRoot = child as THREE.SkinnedMesh;
    }
  });

  return (
    <group>
      {meshes.map((mesh, index) => (
        <HologramMesh key={mesh.uuid ?? index} mesh={mesh} showWireframe={showWireframe} />
      ))}
      {showSkeleton && skinnedRoot ? <SkeletonOverlay root={skinnedRoot} /> : null}
    </group>
  );
}

function SkeletonOverlay({ root }: { root: THREE.SkinnedMesh }) {
  const helper = useMemo(() => {
    const instance = new THREE.SkeletonHelper(root);
    (instance.material as THREE.LineBasicMaterial).linewidth = 2;
    return instance;
  }, [root]);
  useEffect(() => () => helper.dispose(), [helper]);
  return <primitive object={helper} />;
}

function LandmarkMarker({
  name,
  record,
  isSelected,
  onSelect,
  showLabel,
}: {
  name: string;
  record: LandmarkRecord;
  isSelected: boolean;
  onSelect?: (name: string) => void;
  showLabel?: boolean;
}) {
  const position = getLandmarkPosition(record);
  if (!position) return null;
  const state = getLandmarkVisualState(record, isSelected);
  const legend = VISUAL_STATE_LEGEND[state];
  return (
    <Html position={position as [number, number, number]} center zIndexRange={[10, 0]} occlude={false}>
      <button
        type="button"
        className={`${styles.marker} ${styles[`shape_${legend.shape}`]}`}
        style={{ "--marker-color": legend.color } as React.CSSProperties}
        data-state={state}
        title={`${name} · ${legend.label}`}
        aria-pressed={isSelected}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(name);
        }}
      >
        <span className={styles.markerDot} />
        {showLabel ? <span className={styles.markerLabel}>{name}</span> : null}
      </button>
    </Html>
  );
}

function CameraRig({ bbox, focusToken, fillRatio }: { bbox: BoundingBox | null; focusToken: number; fillRatio: number }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!bbox) return;
    const center = boundingBoxCenter(bbox);
    const height = Math.max(bbox.max[1] - bbox.min[1], 0.05);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 32;
    const distance = frameCameraDistance(bbox, fov, fillRatio);
    const horizontalPadding = Math.max(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2]);
    const safeDistance = Math.max(distance, horizontalPadding * 0.8, height * 0.6);
    camera.position.set(center[0], center[1] + height * 0.05, center[2] + safeDistance);
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox?.min.join(","), bbox?.max.join(","), focusToken]);
  return null;
}

function SurfacePicker({ enabled }: { enabled: boolean }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.domElement.style.cursor = enabled ? "crosshair" : "auto";
  }, [enabled, gl]);
  return null;
}

function ViewerContent(props: AvatarAnalyzerViewerProps) {
  const {
    glbUrl,
    landmarks,
    stage,
    dimensions,
    showLandmarks = true,
    showSkeleton = false,
    showWireframe = false,
    showLabels = false,
    selectedName = null,
    onSelectLandmark,
    pickMode = false,
    onSurfacePick,
    focusToken = 0,
    focusOverride = null,
  } = props;

  const stageBbox = useMemo(
    () => computeStageBoundingBox(landmarks, stage === "todos" ? "cuerpo" : stage, dimensions),
    [landmarks, stage, dimensions],
  );
  const bbox = focusOverride ?? stageBbox;

  const visibleEntries = useMemo(
    () => Object.entries(landmarks).filter(([name]) => stage === "todos" || landmarkGroup(name) === stage),
    [landmarks, stage],
  );

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!pickMode || !onSurfacePick) return;
    event.stopPropagation();
    const point = [event.point.x, event.point.y, event.point.z];
    const normal = event.face
      ? [event.face.normal.x, event.face.normal.y, event.face.normal.z]
      : null;
    onSurfacePick({ point, normal });
  };

  const fillRatio = focusOverride ? 0.5 : STAGE_FILL_RATIO[stage === "todos" ? "cuerpo" : stage];

  return (
    <>
      <ambientLight intensity={0.4} />
      <CameraRig bbox={bbox} focusToken={focusToken} fillRatio={fillRatio} />
      <SurfacePicker enabled={pickMode} />
      <group onPointerDown={handlePointerDown}>
        {glbUrl ? (
          <Suspense fallback={null}>
            <AvatarScene url={glbUrl} showWireframe={showWireframe} showSkeleton={showSkeleton} />
          </Suspense>
        ) : null}
      </group>
      {showLandmarks
        ? visibleEntries.map(([name, record]) => (
          <LandmarkMarker
            key={name}
            name={name}
            record={record}
            isSelected={selectedName === name}
            onSelect={onSelectLandmark}
            showLabel={showLabels}
          />
        ))
        : null}
    </>
  );
}

export function AvatarAnalyzerViewer(props: AvatarAnalyzerViewerProps) {
  const { glbUrl, className, emptyLabel } = props;
  const [contextLost, setContextLost] = useState(false);

  if (!glbUrl) {
    return (
      <div className={`${styles.viewer} ${styles.empty} ${className ?? ""}`}>
        <span>{emptyLabel ?? "Todavía no hay un holograma disponible para esta etapa."}</span>
      </div>
    );
  }

  if (contextLost) {
    return (
      <div className={`${styles.viewer} ${styles.empty} ${className ?? ""}`}>
        <span>Se perdió el contexto 3D. Recargá la página para reintentar.</span>
      </div>
    );
  }

  return (
    <div className={`${styles.viewer} ${className ?? ""}`}>
      <Canvas
        camera={{ fov: 32, near: 0.01, far: 100, position: [0, 1, 3] }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            setContextLost(true);
          });
        }}
      >
        <ViewerContent {...props} />
      </Canvas>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className={styles.legend} aria-label="Leyenda de estados de landmarks">
      {Object.entries(VISUAL_STATE_LEGEND)
        .filter(([key]) => key !== "selected")
        .map(([key, value]) => (
          <span key={key} className={styles.legendItem}>
            <i className={`${styles.legendSwatch} ${styles[`shape_${value.shape}`]}`} style={{ "--marker-color": value.color } as React.CSSProperties} />
            {value.label}
          </span>
        ))}
    </div>
  );
}
