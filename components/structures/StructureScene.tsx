"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Camera as ThreeCamera, Shape, Vector3 } from "three";
import type { StructureCameraNodeRecord, StructureImageRecord } from "@/lib/structures/spatial";

type Blockout = {
  height?: number;
  footprint?: Array<{ x: number; y: number }>;
};

type Corner = "NE" | "SE" | "SO" | "NO";

type SceneBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  spanX: number;
  spanY: number;
  span: number;
  pointCount: number;
  fallback: boolean;
};

const MAX_LOCAL_COORDINATE_METERS = 100_000;

function finiteCoordinate(value: unknown) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > MAX_LOCAL_COORDINATE_METERS) return null;
  return number;
}

function nodeLocalPosition(node: StructureCameraNodeRecord) {
  const x = finiteCoordinate(node.local_x);
  const y = finiteCoordinate(node.local_y);
  return x == null || y == null ? null : { x, y };
}

function sceneBounds(
  footprint: Array<{ x: number; y: number }>,
  nodes: StructureCameraNodeRecord[],
): SceneBounds {
  const points: Array<{ x: number; y: number }> = [];

  // local_x/local_y are the canonical local-meter coordinate system used by Structures.
  for (const point of footprint) {
    const x = finiteCoordinate(point.x);
    const y = finiteCoordinate(point.y);
    if (x != null && y != null) points.push({ x, y });
  }
  for (const node of nodes) {
    const point = nodeLocalPosition(node);
    if (point) points.push(point);
  }

  if (!points.length) {
    return {
      minX: -8,
      maxX: 8,
      minY: -8,
      maxY: 8,
      centerX: 0,
      centerY: 0,
      spanX: 16,
      spanY: 16,
      span: 16,
      pointCount: 0,
      fallback: true,
    };
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const rawSpanX = maxX - minX;
  const rawSpanY = maxY - minY;
  const spanX = Math.max(8, rawSpanX);
  const spanY = Math.max(8, rawSpanY);

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    spanX,
    spanY,
    span: Math.max(spanX, spanY),
    pointCount: points.length,
    fallback: false,
  };
}

function BuildingBlockout({ blockout }: { blockout: Blockout }) {
  const footprint = Array.isArray(blockout.footprint) ? blockout.footprint : [];
  const hasFootprint = footprint.length >= 3;
  const hasKnownHeight = Number.isFinite(Number(blockout.height)) && Number(blockout.height) > 0;
  const height = hasKnownHeight ? Math.max(0.5, Math.min(30, Number(blockout.height))) : 0.15;

  const shape = useMemo(() => {
    if (!hasFootprint) return null;
    const next = new Shape();
    next.moveTo(footprint[0].x, footprint[0].y);
    for (const point of footprint.slice(1)) next.lineTo(point.x, point.y);
    next.closePath();
    return next;
  }, [footprint, hasFootprint]);

  if (!shape) return null;

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
        <meshStandardMaterial color="#7c3aed" transparent opacity={hasKnownHeight ? 0.24 : 0.12} />
      </mesh>
      <Line
        points={[...footprint, footprint[0]].map((point) => [point.x, 0.04, -point.y] as [number, number, number])}
        color="#d8b4fe"
        lineWidth={2}
        transparent
        opacity={0.9}
      />
    </>
  );
}

function tweenCamera(args: {
  camera: ThreeCamera;
  controls?: { target?: Vector3; update?: () => void };
  target: Vector3;
  position: Vector3;
  duration?: number;
}) {
  const duration = args.duration ?? 430;
  const startAt = performance.now();
  const fromPosition = args.camera.position.clone();
  const fromTarget = args.controls?.target?.clone?.() ?? new Vector3(0, 0, 0);

  let raf = 0;
  const step = (now: number) => {
    const raw = Math.min(1, (now - startAt) / duration);
    const eased = 1 - Math.pow(1 - raw, 3);
    args.camera.position.lerpVectors(fromPosition, args.position, eased);
    if (args.controls?.target) args.controls.target.lerpVectors(fromTarget, args.target, eased);
    args.camera.lookAt(args.controls?.target ?? args.target);
    args.controls?.update?.();
    if (raw < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function AutoFrameController({
  bounds,
  selectedNode,
  selectionVersion,
  overviewVersion,
}: {
  bounds: SceneBounds;
  selectedNode: StructureCameraNodeRecord | null;
  selectionVersion: string;
  overviewVersion: number;
}) {
  const camera = useThree((state) => state.camera);
  const viewportSize = useThree((state) => state.size);
  const controls = useThree((state) => (
    state as unknown as { controls?: { target?: Vector3; update?: () => void } }
  ).controls);
  const framedSignature = useRef("");
  const previousOverviewVersion = useRef(overviewVersion);

  useEffect(() => {
    const verticalFov = 47 * Math.PI / 180;
    const aspect = Math.max(0.45, viewportSize.width / Math.max(1, viewportSize.height));
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const fitWidthDistance = (bounds.spanX / 2) / Math.tan(horizontalFov / 2);
    const fitHeightDistance = (bounds.spanY / 2) / Math.tan(verticalFov / 2);
    const overviewDistance = Math.max(16, Math.max(fitWidthDistance, fitHeightDistance) * 1.5);
    const viewDirection = new Vector3(0.72, 0.58, 0.82).normalize();
    const overviewTarget = new Vector3(bounds.centerX, 1.2, -bounds.centerY);
    const forceOverview = previousOverviewVersion.current !== overviewVersion;
    previousOverviewVersion.current = overviewVersion;

    const selectedPoint = selectedNode ? nodeLocalPosition(selectedNode) : null;
    if (!forceOverview && selectedPoint) {
      const nodeTarget = new Vector3(selectedPoint.x, 1.25, -selectedPoint.y);
      // Move toward the selected evidence without throwing the rest of the scene away.
      const target = overviewTarget.clone().lerp(nodeTarget, 0.62);
      const distance = Math.max(12, overviewDistance * 0.72);
      const position = target.clone().add(viewDirection.clone().multiplyScalar(distance));
      return tweenCamera({ camera, controls, target, position, duration: 460 });
    }

    const signature = [
      bounds.minX.toFixed(2),
      bounds.maxX.toFixed(2),
      bounds.minY.toFixed(2),
      bounds.maxY.toFixed(2),
      selectionVersion,
      overviewVersion,
      viewportSize.width,
      viewportSize.height,
    ].join(":");
    if (framedSignature.current === signature) return;
    framedSignature.current = signature;

    const position = overviewTarget.clone().add(viewDirection.multiplyScalar(overviewDistance));
    return tweenCamera({ camera, controls, target: overviewTarget, position, duration: 520 });
  }, [
    bounds.centerX,
    bounds.centerY,
    bounds.maxX,
    bounds.maxY,
    bounds.minX,
    bounds.minY,
    bounds.spanX,
    bounds.spanY,
    camera,
    controls,
    overviewVersion,
    selectedNode?.id,
    selectedNode?.local_x,
    selectedNode?.local_y,
    selectionVersion,
    viewportSize.height,
    viewportSize.width,
  ]);

  return null;
}

function nodeTone(image: StructureImageRecord) {
  if (image.placement_status === "blocked") return "#ef4444";
  if (image.placement_status === "needs_review") return "#f59e0b";
  if (image.spatial_source === "manual" || image.manual_verified) return "#22d3ee";
  if (image.spatial_source === "inferred_cloud") return "#fbbf24";
  return "#a78bfa";
}

function directionPoints(
  x: number,
  z: number,
  heading: number,
  fov: number | null,
  length = 5,
) {
  const normalizedFov = Math.max(24, Math.min(110, fov ?? 55));
  const center = heading * Math.PI / 180;
  const half = (normalizedFov / 2) * Math.PI / 180;
  const target = (angle: number): [number, number, number] => [
    x + Math.sin(angle) * length,
    1.35,
    z - Math.cos(angle) * length,
  ];
  return {
    center: target(center),
    left: target(center - half),
    right: target(center + half),
  };
}

function CameraNodes({
  images,
  cameraNodes,
  selectedImageId,
  onSelectImage,
  editMode,
  draftPosition,
  draggingImageId,
  onStartDrag,
  sceneSpan,
  onRequestOverview,
}: {
  images: StructureImageRecord[];
  cameraNodes: StructureCameraNodeRecord[];
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  editMode: boolean;
  draftPosition: { imageId: string; localX: number; localY: number } | null;
  draggingImageId: string | null;
  onStartDrag: (imageId: string) => void;
  sceneSpan: number;
  onRequestOverview: () => void;
}) {
  const imageById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);

  return (
    <>
      {cameraNodes
        .filter((node) => nodeLocalPosition(node) != null)
        .map((node) => {
          const image = imageById.get(node.image_id);
          if (!image) return null;

          const point = nodeLocalPosition(node);
          if (!point) return null;
          const isDraft = draftPosition?.imageId === image.id;
          const x = isDraft ? draftPosition.localX : point.x;
          const localY = isDraft ? draftPosition.localY : point.y;
          const z = -localY;
          const selected = image.id === selectedImageId;
          const heading = node.heading ?? image.heading;
          const tone = nodeTone(image);
          const nodeRadius = Math.max(0.31, Math.min(0.68, sceneSpan * 0.0046));
          const rayLength = Math.max(4.5, Math.min(10, sceneSpan * 0.058));
          const rays = heading == null ? null : directionPoints(
            x,
            z,
            heading,
            node.fov ?? image.fov,
            selected ? rayLength * 1.25 : rayLength,
          );

          return (
            <group key={node.id}>
              {selected ? (
                <>
                  <mesh position={[x, 1.35, z]} scale={2.15}>
                    <sphereGeometry args={[nodeRadius, 24, 24]} />
                    <meshBasicMaterial color={tone} transparent opacity={0.14} depthWrite={false} />
                  </mesh>
                  <mesh position={[x, 0.035, z]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.62, 0.92, 48]} />
                    <meshBasicMaterial color={tone} transparent opacity={0.9} />
                  </mesh>
                </>
              ) : null}

              <mesh
                position={[x, 1.35, z]}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectImage(image.id);
                }}
                onPointerDown={(event) => {
                  if (!editMode) return;
                  event.stopPropagation();
                  onSelectImage(image.id);
                  onStartDrag(image.id);
                }}
                scale={selected ? 1.58 : 1}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onRequestOverview();
                }}
              >
                <sphereGeometry args={[nodeRadius, 22, 22]} />
                <meshStandardMaterial
                  color={selected ? "#ffffff" : tone}
                  emissive={tone}
                  emissiveIntensity={selected ? 1.35 : 0.38}
                  roughness={0.32}
                  metalness={0.08}
                />
              </mesh>

              {rays ? (
                <>
                  <Line
                    points={[[x, 1.35, z], rays.center]}
                    color={selected ? "#ffffff" : tone}
                    lineWidth={selected ? 3 : 1.5}
                    transparent
                    opacity={selected ? 1 : 0.76}
                  />
                  <Line
                    points={[[x, 1.35, z], rays.left, rays.right, [x, 1.35, z]]}
                    color={tone}
                    lineWidth={selected ? 1.6 : 0.9}
                    transparent
                    opacity={selected ? 0.68 : 0.3}
                  />
                </>
              ) : null}

              {selected ? (
                <Html position={[x, 3.05, z]} center distanceFactor={7.5} zIndexRange={[60, 0]}>
                  <div className="pointer-events-none w-60 overflow-hidden rounded-2xl border border-white/20 bg-[#07050b]/95 p-2 shadow-2xl shadow-black/80 backdrop-blur-xl">
                    <img
                      src={image.public_url}
                      alt=""
                      className="aspect-video w-full rounded-xl border border-white/10 object-cover"
                    />
                    <div className="px-1 pb-1 pt-2">
                      <p className="truncate text-[11px] font-semibold text-white">
                        {image.ordered_filename || image.original_filename}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.11em]">
                        <span className="text-white/60">
                          {image.cardinal_direction || "sin rumbo"}
                          {image.heading == null ? "" : ` · ${image.heading.toFixed(1)}°`}
                        </span>
                        <span style={{ color: tone }}>{image.spatial_source}</span>
                      </div>
                    </div>
                  </div>
                </Html>
              ) : null}

              {draggingImageId === image.id ? (
                <mesh position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.55, 0.82, 40]} />
                  <meshBasicMaterial color="#22d3ee" transparent opacity={0.9} />
                </mesh>
              ) : null}
            </group>
          );
        })}
    </>
  );
}

function DragPlane({
  active,
  onMove,
  onCommit,
}: {
  active: boolean;
  onMove: (localX: number, localY: number) => void;
  onCommit: () => void;
}) {
  if (!active) return null;
  return (
    <mesh
      position={[0, 0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onMove(event.point.x, -event.point.z);
      }}
      onPointerUp={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onMove(event.point.x, -event.point.z);
        onCommit();
      }}
    >
      <planeGeometry args={[1000, 1000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function CornerNodes({
  blockout,
  selected,
  onSelect,
}: {
  blockout: Blockout;
  selected: Corner | null;
  onSelect: (corner: Corner) => void;
}) {
  const footprint = Array.isArray(blockout.footprint) ? blockout.footprint : [];
  if (footprint.length < 3) return null;

  const bounds = sceneBounds(footprint, []);
  const corners: Array<{ key: Corner; point: [number, number, number] }> = [
    { key: "NO", point: [bounds.minX, 0.2, -bounds.maxY] },
    { key: "NE", point: [bounds.maxX, 0.2, -bounds.maxY] },
    { key: "SO", point: [bounds.minX, 0.2, -bounds.minY] },
    { key: "SE", point: [bounds.maxX, 0.2, -bounds.minY] },
  ];

  return (
    <>
      {corners.map((corner) => (
        <mesh
          key={corner.key}
          position={corner.point}
          scale={selected === corner.key ? 1.35 : 1}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(corner.key);
          }}
        >
          <sphereGeometry args={[0.34, 20, 20]} />
          <meshStandardMaterial
            color={selected === corner.key ? "#ffffff" : "#22d3ee"}
            emissive="#22d3ee"
            emissiveIntensity={selected === corner.key ? 0.8 : 0.25}
          />
        </mesh>
      ))}
    </>
  );
}

function NorthIndicator({ bounds }: { bounds: SceneBounds }) {
  const x = bounds.minX + Math.max(2.5, bounds.span * 0.04);
  const z = -bounds.maxY + Math.max(2.5, bounds.span * 0.04);
  return (
    <group position={[x, 0.05, z]}>
      <Line points={[[0, 0, 0], [0, 0, -3.3]]} color="#67e8f9" lineWidth={1.6} />
      <mesh position={[0, 0, -3.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.35, 0.8, 12]} />
        <meshBasicMaterial color="#67e8f9" />
      </mesh>
      <Html position={[0, 0.45, -4.1]} center distanceFactor={11}>
        <div className="pointer-events-none rounded-full border border-cyan-300/20 bg-black/75 px-2 py-1 text-[9px] font-bold text-cyan-200 backdrop-blur">
          N
        </div>
      </Html>
    </group>
  );
}

export function StructureScene({
  images,
  cameraNodes,
  blockout,
  selectedImageId,
  onSelectImage,
  selectedCorner,
  onSelectCorner,
  editMode = false,
  onMoveImage,
}: {
  images: StructureImageRecord[];
  cameraNodes: StructureCameraNodeRecord[];
  blockout: Blockout;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  selectedCorner: Corner | null;
  onSelectCorner: (corner: Corner) => void;
  editMode?: boolean;
  onMoveImage?: (imageId: string, localX: number, localY: number) => Promise<void>;
}) {
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [draftPosition, setDraftPosition] = useState<{ imageId: string; localX: number; localY: number } | null>(null);
  const [overviewVersion, setOverviewVersion] = useState(0);

  const footprint = Array.isArray(blockout.footprint) ? blockout.footprint : [];
  const positionedNodes = useMemo(
    () => cameraNodes.filter((node) => nodeLocalPosition(node) != null),
    [cameraNodes],
  );
  const bounds = useMemo(() => sceneBounds(footprint, positionedNodes), [footprint, positionedNodes]);
  const selectedNode = cameraNodes.find((node) => node.image_id === selectedImageId) ?? null;
  const gridSize = Math.max(30, Math.min(280, bounds.span * 2.5));
  const cameraDistance = Math.max(18, bounds.span * 0.95);
  const cameraNear = Math.max(bounds.span / 10_000, 0.01);
  const cameraFar = Math.max(bounds.span * 50, 1000);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const invalidCameraCount = cameraNodes.length - positionedNodes.length;
    console.table({
      cameraCount: cameraNodes.length,
      validCameraCount: positionedNodes.length,
      invalidCameraCount,
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      maxDimension: bounds.span,
    });
    if (invalidCameraCount > 0) {
      console.warn("INVALID_CAMERA_COORDINATE", { invalidCameraCount });
    }
    if (bounds.fallback || !Number.isFinite(bounds.span) || bounds.span <= 0) {
      console.warn("INVALID_SPATIAL_BOUNDS", bounds);
    }
    if (bounds.span > 5000) {
      console.warn("SPATIAL_SCALE_OUTLIER", { spanMeters: bounds.span });
    }
  }, [bounds, cameraNodes.length, positionedNodes.length]);

  function startDrag(imageId: string) {
    const node = cameraNodes.find((candidate) => candidate.image_id === imageId);
    if (!node || node.local_x == null || node.local_y == null) return;
    setDraggingImageId(imageId);
    setDraftPosition({ imageId, localX: node.local_x, localY: node.local_y });
  }

  async function commitDrag() {
    if (!draggingImageId || !draftPosition || !onMoveImage) {
      setDraggingImageId(null);
      setDraftPosition(null);
      return;
    }
    const imageId = draggingImageId;
    const { localX, localY } = draftPosition;
    setDraggingImageId(null);
    setDraftPosition(null);
    await onMoveImage(imageId, localX, localY);
  }

  return (
    <div className="relative h-[500px] w-full overflow-hidden rounded-[1.7rem] border border-white/10 bg-[radial-gradient(circle_at_50%_32%,rgba(76,29,149,0.11),rgba(5,3,10,0.96)_52%)]">
      <Canvas dpr={[1, 1.5]} gl={{ antialias: true }}>
        <PerspectiveCamera
          makeDefault
          position={[
            bounds.centerX + cameraDistance * 0.72,
            cameraDistance * 0.58,
            -bounds.centerY + cameraDistance * 0.82,
          ]}
          fov={47}
          near={cameraNear}
          far={cameraFar}
        />
        <ambientLight intensity={1.45} />
        <directionalLight position={[12, 18, 10]} intensity={2.2} />

        <group position={[bounds.centerX, 0, -bounds.centerY]}>
          <Grid
            args={[gridSize, gridSize]}
            cellSize={1}
            cellThickness={0.14}
            cellColor="#1d1729"
            sectionSize={5}
            sectionThickness={0.34}
            sectionColor="#362946"
            fadeDistance={gridSize * 0.42}
            fadeStrength={2.2}
            infiniteGrid={false}
          />
        </group>

        <BuildingBlockout blockout={blockout} />
        <CameraNodes
          images={images}
          cameraNodes={cameraNodes}
          selectedImageId={selectedImageId}
          onSelectImage={onSelectImage}
          editMode={editMode}
          draftPosition={draftPosition}
          draggingImageId={draggingImageId}
          onStartDrag={startDrag}
          sceneSpan={bounds.span}
          onRequestOverview={() => setOverviewVersion((value) => value + 1)}
        />
        <mesh
          position={[bounds.centerX, 0.005, -bounds.centerY]}
          rotation={[-Math.PI / 2, 0, 0]}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setOverviewVersion((value) => value + 1);
          }}
        >
          <planeGeometry args={[gridSize, gridSize]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <DragPlane
          active={Boolean(editMode && draggingImageId)}
          onMove={(localX, localY) => {
            if (!draggingImageId) return;
            setDraftPosition({ imageId: draggingImageId, localX, localY });
          }}
          onCommit={() => { void commitDrag(); }}
        />
        <CornerNodes blockout={blockout} selected={selectedCorner} onSelect={onSelectCorner} />
        <NorthIndicator bounds={bounds} />
        <AutoFrameController
          bounds={bounds}
          selectedNode={draggingImageId ? null : selectedNode}
          selectionVersion={selectedImageId ?? "none"}
          overviewVersion={overviewVersion}
        />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enabled={!draggingImageId}
          minDistance={4}
          maxDistance={Math.max(45, bounds.span * 2.5)}
          maxPolarAngle={Math.PI * 0.48}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/65 backdrop-blur">
        {footprint.length >= 3
          ? (Number(blockout.height) > 0 ? "Plano + cámaras reales" : "Huella + cámaras reales")
          : "Nube de cámaras reales"}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] text-white/60 backdrop-blur">
        <span>{positionedNodes.length} cámaras ubicadas</span>
        <span className="h-1 w-1 rounded-full bg-white/25" />
        <span>{Math.round(bounds.span)} m de cobertura</span>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[9px] text-white/45 backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-violet-400" /> metadatos
        <span className="h-2 w-2 rounded-full bg-amber-300" /> IA
        <span className="h-2 w-2 rounded-full bg-cyan-300" /> manual
      </div>

      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setOverviewVersion((value) => value + 1)}
          className="pointer-events-auto rounded-full border border-white/15 bg-black/75 px-3 py-1.5 text-[10px] font-medium text-white/75 backdrop-blur transition hover:border-white/30 hover:text-white"
        >
          Encuadrar todo
        </button>
        {editMode ? (
          <div className="pointer-events-none rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-cyan-100 backdrop-blur">
            Ajuste manual · arrastrá un nodo
          </div>
        ) : null}
      </div>
    </div>
  );
}
