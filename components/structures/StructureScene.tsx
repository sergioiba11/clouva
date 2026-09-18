"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Shape, Vector3 } from "three";
import type { StructureCameraNodeRecord, StructureImageRecord } from "@/lib/structures/spatial";

type Blockout = {
  height?: number;
  footprint?: Array<{ x: number; y: number }>;
};

type Corner = "NE" | "SE" | "SO" | "NO";

function boundsOf(footprint: Array<{ x: number; y: number }>) {
  if (!footprint.length) return { minX: -5, maxX: 5, minY: -5, maxY: 5 };
  return footprint.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: footprint[0].x,
      maxX: footprint[0].x,
      minY: footprint[0].y,
      maxY: footprint[0].y,
    },
  );
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

  if (!shape) {
    return (
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[10, 3, 10]} />
        <meshStandardMaterial color="#6d28d9" transparent opacity={0.13} wireframe />
      </mesh>
    );
  }

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
        <meshStandardMaterial color="#7c3aed" transparent opacity={0.18} />
      </mesh>
      <Line
        points={[...footprint, footprint[0]].map((point) => [point.x, 0.03, -point.y] as [number, number, number])}
        color="#c4b5fd"
        lineWidth={1.5}
      />
    </>
  );
}

function FocusController({
  node,
}: {
  node: StructureCameraNodeRecord | null;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => (
    state as unknown as { controls?: { target?: Vector3; update?: () => void } }
  ).controls);

  useEffect(() => {
    if (!node || node.local_x == null || node.local_y == null) return;
    const target = new Vector3(node.local_x, 1.25, -node.local_y);
    const currentOffset = camera.position.clone().sub(target);
    const offset = currentOffset.length() > 0.1
      ? currentOffset.normalize().multiplyScalar(10)
      : new Vector3(7, 5.5, 7);
    camera.position.copy(target.clone().add(offset));
    camera.lookAt(target);
    if (controls?.target) controls.target.copy(target);
    controls?.update?.();
  }, [camera, controls, node?.id, node?.local_x, node?.local_y]);

  return null;
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
}: {
  images: StructureImageRecord[];
  cameraNodes: StructureCameraNodeRecord[];
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  editMode: boolean;
  draftPosition: { imageId: string; localX: number; localY: number } | null;
  draggingImageId: string | null;
  onStartDrag: (imageId: string) => void;
}) {
  const imageById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);

  return (
    <>
      {cameraNodes
        .filter((node) => node.local_x != null && node.local_y != null)
        .map((node) => {
          const image = imageById.get(node.image_id);
          if (!image) return null;
          const isDraft = draftPosition?.imageId === image.id;
          const x = isDraft ? draftPosition.localX : (node.local_x ?? 0);
          const localY = isDraft ? draftPosition.localY : (node.local_y ?? 0);
          const z = -localY;
          const selected = image.id === selectedImageId;
          const radians = ((node.heading ?? image.heading ?? 0) * Math.PI) / 180;
          const target: [number, number, number] = [
            x + Math.sin(radians) * 4,
            1.35,
            z - Math.cos(radians) * 4,
          ];

          return (
            <group key={node.id}>
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
                scale={selected ? 1.55 : 1}
              >
                <sphereGeometry args={[0.28, 18, 18]} />
                <meshStandardMaterial
                  color={selected ? "#ffffff" : image.spatial_source === "inferred_cloud" ? "#f59e0b" : "#a78bfa"}
                />
              </mesh>

              {(node.heading ?? image.heading) != null ? (
                <Line
                  points={[[x, 1.35, z], target]}
                  color={selected ? "#ffffff" : image.spatial_source === "inferred_cloud" ? "#f59e0b" : "#8b5cf6"}
                  lineWidth={selected ? 2.5 : 1.2}
                  transparent
                  opacity={selected ? 0.95 : 0.58}
                />
              ) : null}

              {selected ? (
                <Html position={[x, 2.15, z]} center distanceFactor={9} zIndexRange={[20, 0]}>
                  <div className="pointer-events-none w-32 overflow-hidden rounded-xl border border-white/20 bg-black/90 p-1.5 shadow-2xl shadow-black/70 backdrop-blur">
                    <img src={image.public_url} alt="" className="aspect-video w-full rounded-lg object-cover" />
                    <p className="mt-1 truncate px-1 text-[9px] font-semibold text-white">
                      {image.cardinal_direction || "sin rumbo"} · {image.spatial_source}
                    </p>
                  </div>
                </Html>
              ) : null}

              {draggingImageId === image.id ? (
                <mesh position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.5, 0.7, 32]} />
                  <meshBasicMaterial color="#22d3ee" transparent opacity={0.8} />
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
      <planeGeometry args={[500, 500]} />
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
  const bounds = boundsOf(footprint);
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
          <meshStandardMaterial color={selected === corner.key ? "#ffffff" : "#22d3ee"} />
        </mesh>
      ))}
    </>
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
  const footprint = Array.isArray(blockout.footprint) ? blockout.footprint : [];
  const bounds = boundsOf(footprint);
  const positionedNodes = cameraNodes.filter((node) => node.local_x != null && node.local_y != null);
  const selectedNode = cameraNodes.find((node) => node.image_id === selectedImageId) ?? null;
  const span = Math.max(
    16,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    ...positionedNodes.map((node) => Math.hypot(node.local_x ?? 0, node.local_y ?? 0) * 1.3),
  );

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
    <div className="relative h-[430px] w-full overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#07050b]">
      <Canvas dpr={[1, 1.5]} gl={{ antialias: true }}>
        <PerspectiveCamera makeDefault position={[span * 0.65, span * 0.55, span * 0.8]} fov={48} />
        <ambientLight intensity={1.25} />
        <directionalLight position={[12, 18, 10]} intensity={2} />
        <Grid
          args={[Math.max(80, span * 2), Math.max(80, span * 2)]}
          cellSize={1}
          cellThickness={0.35}
          cellColor="#2e253d"
          sectionSize={5}
          sectionThickness={0.7}
          sectionColor="#4c3b64"
          fadeDistance={span * 1.5}
          fadeStrength={1}
          infiniteGrid
        />
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
        />
        <DragPlane
          active={Boolean(editMode && draggingImageId)}
          onMove={(localX, localY) => {
            if (!draggingImageId) return;
            setDraftPosition({ imageId: draggingImageId, localX, localY });
          }}
          onCommit={() => { void commitDrag(); }}
        />
        <CornerNodes blockout={blockout} selected={selectedCorner} onSelect={onSelectCorner} />
        <FocusController node={draggingImageId ? null : selectedNode} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enabled={!draggingImageId}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/60 backdrop-blur">
        {footprint.length >= 3
          ? (Number(blockout.height) > 0 ? "Blockout del plano" : "Huella cargada · altura pendiente")
          : "Cámaras reales · plano opcional"}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] text-white/55 backdrop-blur">
        {positionedNodes.length} cámaras ubicadas
      </div>
      {editMode ? (
        <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-cyan-100 backdrop-blur">
          Ajuste manual · arrastrá un nodo
        </div>
      ) : null}
    </div>
  );
}
