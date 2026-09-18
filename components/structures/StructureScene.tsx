"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Shape, Vector3 } from "three";
import {
  cameraDirectionLocal,
  geoToLocalMeters,
  type StructureCameraNodeRecord,
  type StructureImageRecord,
  type StructureRecord,
  type StructureSpatialFeatureRecord,
} from "@/lib/structures/spatial";

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

  if (!shape) return null;

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
        <meshStandardMaterial color="#7c3aed" transparent opacity={0.12} />
      </mesh>
      <Line
        points={[...footprint, footprint[0]].map((point) => [point.x, 0.03, -point.y] as [number, number, number])}
        color="#c4b5fd"
        lineWidth={1.5}
      />
    </>
  );
}

function nodePosition(node: StructureCameraNodeRecord) {
  const x = node.position_x ?? node.local_x;
  const y = node.position_y ?? node.local_z ?? 0;
  const z = node.position_z ?? (node.local_y == null ? null : -node.local_y);
  return x == null || z == null ? null : { x, y, z };
}

function FocusController({ node }: { node: StructureCameraNodeRecord | null }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => (
    state as unknown as { controls?: { target?: Vector3; update?: () => void } }
  ).controls);

  useEffect(() => {
    if (!node) return;
    const position = nodePosition(node);
    if (!position) return;
    const target = new Vector3(position.x, Math.max(1.25, position.y + 1), position.z);
    const currentOffset = camera.position.clone().sub(target);
    const offset = currentOffset.length() > 0.1
      ? currentOffset.normalize().multiplyScalar(10)
      : new Vector3(7, 5.5, 7);
    camera.position.copy(target.clone().add(offset));
    camera.lookAt(target);
    if (controls?.target) controls.target.copy(target);
    controls?.update?.();
  }, [camera, controls, node?.id, node?.position_x, node?.position_y, node?.position_z, node?.local_x, node?.local_y]);

  return null;
}

function CameraFrustum({
  origin,
  heading,
  pitch,
  fov,
  northRotationDeg,
  selected,
}: {
  origin: [number, number, number];
  heading: number;
  pitch: number | null;
  fov: number | null;
  northRotationDeg: number;
  selected: boolean;
}) {
  if (fov == null || !Number.isFinite(fov) || fov <= 1 || fov >= 175) return null;
  const direction = cameraDirectionLocal({
    headingDeg: heading,
    pitchDeg: pitch,
    northRotationDeg,
  });
  const forward = new Vector3(direction.x, direction.y, direction.z).normalize();
  const worldUp = Math.abs(forward.y) > 0.96 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(forward, worldUp).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const length = selected ? 6 : 4.5;
  const half = Math.tan((fov * Math.PI / 180) / 2) * length;
  const center = new Vector3(...origin).add(forward.clone().multiplyScalar(length));
  const corners = [
    center.clone().add(right.clone().multiplyScalar(half)).add(up.clone().multiplyScalar(half * 0.62)),
    center.clone().add(right.clone().multiplyScalar(-half)).add(up.clone().multiplyScalar(half * 0.62)),
    center.clone().add(right.clone().multiplyScalar(-half)).add(up.clone().multiplyScalar(-half * 0.62)),
    center.clone().add(right.clone().multiplyScalar(half)).add(up.clone().multiplyScalar(-half * 0.62)),
  ];
  const color = selected ? "#ffffff" : "#8b5cf6";
  return (
    <>
      {corners.map((corner, index) => (
        <Line
          key={index}
          points={[origin, [corner.x, corner.y, corner.z]]}
          color={color}
          lineWidth={selected ? 1.6 : 0.7}
          transparent
          opacity={selected ? 0.9 : 0.28}
        />
      ))}
      <Line
        points={[...corners, corners[0]].map((point) => [point.x, point.y, point.z] as [number, number, number])}
        color={color}
        lineWidth={selected ? 1.5 : 0.7}
        transparent
        opacity={selected ? 0.85 : 0.25}
      />
    </>
  );
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
  northRotationDeg,
}: {
  images: StructureImageRecord[];
  cameraNodes: StructureCameraNodeRecord[];
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  editMode: boolean;
  draftPosition: { imageId: string; localX: number; localY: number } | null;
  draggingImageId: string | null;
  onStartDrag: (imageId: string) => void;
  northRotationDeg: number;
}) {
  const imageById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);

  return (
    <>
      {cameraNodes.map((node) => {
        const image = imageById.get(node.image_id);
        const position = nodePosition(node);
        if (!image || !position) return null;

        const isDraft = draftPosition?.imageId === image.id;
        const x = isDraft ? draftPosition.localX : position.x;
        const z = isDraft ? -draftPosition.localY : position.z;
        const y = Math.max(0.15, position.y + 1.35);
        const selected = image.id === selectedImageId;
        const heading = node.heading ?? image.heading;
        const direction = heading == null ? null : cameraDirectionLocal({
          headingDeg: heading,
          pitchDeg: node.pitch ?? image.pitch,
          northRotationDeg,
        });
        const target: [number, number, number] | null = direction
          ? [x + direction.x * 4, y + direction.y * 4, z + direction.z * 4]
          : null;

        return (
          <group key={node.id}>
            <mesh
              position={[x, y, z]}
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

            {target ? (
              <Line
                points={[[x, y, z], target]}
                color={selected ? "#ffffff" : image.spatial_source === "inferred_cloud" ? "#f59e0b" : "#8b5cf6"}
                lineWidth={selected ? 2.5 : 1.2}
                transparent
                opacity={selected ? 0.95 : 0.58}
              />
            ) : null}

            {heading != null ? (
              <CameraFrustum
                origin={[x, y, z]}
                heading={heading}
                pitch={node.pitch ?? image.pitch}
                fov={node.fov ?? image.fov}
                northRotationDeg={northRotationDeg}
                selected={selected}
              />
            ) : null}

            {selected ? (
              <Html position={[x, y + 0.8, z]} center distanceFactor={9} zIndexRange={[20, 0]}>
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

function localFeaturePoints(feature: StructureSpatialFeatureRecord, structure: StructureRecord) {
  if (structure.origin_latitude == null || structure.origin_longitude == null) return [];
  const coordinates = feature.geometry.type === "Point"
    ? [feature.geometry.coordinates]
    : feature.geometry.type === "LineString"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates[0] ?? [];
  return coordinates.map(([lon, lat]) => geoToLocalMeters({
    lat,
    lon,
    originLat: structure.origin_latitude as number,
    originLon: structure.origin_longitude as number,
    originAlt: structure.origin_alt,
    northRotationDeg: structure.north_rotation_deg,
  }));
}

function SpatialFeatures3D({
  features,
  structure,
  selectedFeatureId,
  onSelectFeature,
}: {
  features: StructureSpatialFeatureRecord[];
  structure: StructureRecord;
  selectedFeatureId: string | null;
  onSelectFeature: (featureId: string) => void;
}) {
  return (
    <>
      {features.map((feature) => {
        const local = localFeaturePoints(feature, structure);
        if (!local.length) return null;
        const selected = feature.id === selectedFeatureId;
        const color = selected ? "#22d3ee" : feature.feature_type === "building_footprint" ? "#c4b5fd" : "#94a3b8";

        if (feature.geometry.type === "Point") {
          const point = local[0];
          return (
            <mesh
              key={feature.id}
              position={[point.x, 0.12, point.z]}
              scale={selected ? 1.35 : 1}
              onClick={(event) => { event.stopPropagation(); onSelectFeature(feature.id); }}
            >
              <sphereGeometry args={[0.2, 16, 16]} />
              <meshStandardMaterial color={color} />
            </mesh>
          );
        }

        if (feature.geometry.type === "LineString") {
          return (
            <Line
              key={feature.id}
              points={local.map((point) => [point.x, 0.05, point.z] as [number, number, number])}
              color={color}
              lineWidth={selected ? 3 : 1.5}
              onClick={(event) => { event.stopPropagation(); onSelectFeature(feature.id); }}
            />
          );
        }

        const ring = local.length > 1 && local[0].x === local[local.length - 1].x && local[0].z === local[local.length - 1].z
          ? local.slice(0, -1)
          : local;
        if (ring.length < 3) return null;

        const volumeEnabled = feature.properties.volume_enabled === true;
        const rawHeight = Number(feature.properties.height_m);
        const height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.min(80, rawHeight) : 3;
        const shape = new Shape();
        shape.moveTo(ring[0].x, -ring[0].z);
        for (const point of ring.slice(1)) shape.lineTo(point.x, -point.z);
        shape.closePath();

        return (
          <group key={feature.id}>
            <Line
              points={[...ring, ring[0]].map((point) => [point.x, 0.06, point.z] as [number, number, number])}
              color={color}
              lineWidth={selected ? 3 : 1.5}
              onClick={(event) => { event.stopPropagation(); onSelectFeature(feature.id); }}
            />
            {feature.feature_type === "building_footprint" && volumeEnabled ? (
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                onClick={(event) => { event.stopPropagation(); onSelectFeature(feature.id); }}
              >
                <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
                <meshStandardMaterial color="#7c3aed" transparent opacity={selected ? 0.28 : 0.16} />
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
  if (footprint.length < 3) return null;
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
  structure,
  images,
  cameraNodes,
  spatialFeatures,
  blockout,
  selectedImageId,
  onSelectImage,
  selectedFeatureId,
  onSelectFeature,
  selectedCorner,
  onSelectCorner,
  editMode = false,
  onMoveImage,
}: {
  structure: StructureRecord;
  images: StructureImageRecord[];
  cameraNodes: StructureCameraNodeRecord[];
  spatialFeatures: StructureSpatialFeatureRecord[];
  blockout: Blockout;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  selectedFeatureId: string | null;
  onSelectFeature: (id: string) => void;
  selectedCorner: Corner | null;
  onSelectCorner: (corner: Corner) => void;
  editMode?: boolean;
  onMoveImage?: (imageId: string, localX: number, localY: number) => Promise<void>;
}) {
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [draftPosition, setDraftPosition] = useState<{ imageId: string; localX: number; localY: number } | null>(null);
  const footprint = Array.isArray(blockout.footprint) ? blockout.footprint : [];
  const bounds = boundsOf(footprint);
  const positionedNodes = cameraNodes.filter((node) => nodePosition(node) != null);
  const selectedNode = cameraNodes.find((node) => node.image_id === selectedImageId) ?? null;
  const featureSpan = spatialFeatures.flatMap((feature) => localFeaturePoints(feature, structure)).map((point) => Math.hypot(point.x, point.z) * 1.3);
  const span = Math.max(
    16,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    ...positionedNodes.map((node) => {
      const position = nodePosition(node);
      return position ? Math.hypot(position.x, position.z) * 1.3 : 0;
    }),
    ...featureSpan,
  );

  function startDrag(imageId: string) {
    const node = cameraNodes.find((candidate) => candidate.image_id === imageId);
    if (!node) return;
    const position = nodePosition(node);
    if (!position) return;
    setDraggingImageId(imageId);
    setDraftPosition({ imageId, localX: position.x, localY: -position.z });
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
    <div className="relative h-full min-h-[430px] w-full overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#07050b]">
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
        <SpatialFeatures3D
          features={spatialFeatures}
          structure={structure}
          selectedFeatureId={selectedFeatureId}
          onSelectFeature={onSelectFeature}
        />
        <CameraNodes
          images={images}
          cameraNodes={cameraNodes}
          selectedImageId={selectedImageId}
          onSelectImage={onSelectImage}
          editMode={editMode}
          draftPosition={draftPosition}
          draggingImageId={draggingImageId}
          onStartDrag={startDrag}
          northRotationDeg={structure.north_rotation_deg ?? 0}
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
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} enabled={!draggingImageId} />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/60 backdrop-blur">
        X Este · Y altura · Z Sur
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] text-white/55 backdrop-blur">
        {positionedNodes.length} cámaras · {spatialFeatures.length} geometrías
      </div>
      {editMode ? (
        <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-cyan-100 backdrop-blur">
          Ajuste manual · arrastrá un nodo
        </div>
      ) : null}
    </div>
  );
}
