"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Shape } from "three";
import type { StructureImageRecord } from "@/lib/structures/spatial";

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
  const hasKnownHeight = Number.isFinite(Number(blockout.height)) && Number(blockout.height) > 0;\n  const height = hasKnownHeight ? Math.max(0.5, Math.min(30, Number(blockout.height))) : 0.15;

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

function CameraNodes({
  images,
  selectedImageId,
  onSelectImage,
}: {
  images: StructureImageRecord[];
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
}) {
  const nodes = images.filter((image) => image.local_x != null && image.local_y != null);
  return (
    <>
      {nodes.map((image) => {
        const selected = image.id === selectedImageId;
        const x = image.local_x ?? 0;
        const z = -(image.local_y ?? 0);
        const radians = ((image.heading ?? 0) * Math.PI) / 180;
        const target: [number, number, number] = [
          x + Math.sin(radians) * 3,
          1.35,
          z - Math.cos(radians) * 3,
        ];
        return (
          <group key={image.id}>
            <mesh
              position={[x, 1.35, z]}
              onClick={(event) => {
                event.stopPropagation();
                onSelectImage(image.id);
              }}
              scale={selected ? 1.45 : 1}
            >
              <sphereGeometry args={[0.25, 18, 18]} />
              <meshStandardMaterial color={selected ? "#ffffff" : "#a78bfa"} />
            </mesh>
            {image.heading != null ? (
              <Line
                points={[[x, 1.35, z], target]}
                color={selected ? "#ffffff" : "#8b5cf6"}
                lineWidth={selected ? 2 : 1}
                transparent
                opacity={selected ? 0.95 : 0.5}
              />
            ) : null}
          </group>
        );
      })}
    </>
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
  blockout,
  selectedImageId,
  onSelectImage,
  selectedCorner,
  onSelectCorner,
}: {
  images: StructureImageRecord[];
  blockout: Blockout;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  selectedCorner: Corner | null;
  onSelectCorner: (corner: Corner) => void;
}) {
  const geolocated = images.filter((image) => image.local_x != null && image.local_y != null).length;
  const footprint = Array.isArray(blockout.footprint) ? blockout.footprint : [];
  const bounds = boundsOf(footprint);
  const span = Math.max(
    16,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    ...images
      .filter((image) => image.local_x != null && image.local_y != null)
      .map((image) => Math.hypot(image.local_x ?? 0, image.local_y ?? 0) * 1.3),
  );

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
        <CameraNodes images={images} selectedImageId={selectedImageId} onSelectImage={onSelectImage} />
        <CornerNodes blockout={blockout} selected={selectedCorner} onSelect={onSelectCorner} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/60 backdrop-blur">
        {footprint.length >= 3\n          ? (Number(blockout.height) > 0 ? "Blockout del plano" : "Huella cargada · altura pendiente")\n          : "Volumen de referencia · sin medidas"}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[10px] text-white/55 backdrop-blur">
        {geolocated} cámaras con posición espacial real
      </div>
    </div>
  );
}
