"use client";

import { Suspense, useState } from "react";
import type { AvatarConfig } from "@/lib/avatar-engine/types";
import { AvatarCharacter } from "./AvatarCharacter";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function AvatarCanvas({ config }: { config: AvatarConfig }) {
  const [rotation, setRotation] = useState({ x: -6, y: 18 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  return (
    <section
      className="avatar-canvas"
      onPointerDown={(event) => setDrag({ x: event.clientX, y: event.clientY })}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
      onPointerMove={(event) => {
        if (!drag) return;
        setRotation((value) => ({ x: clamp(value.x - (event.clientY - drag.y) * 0.12, -18, 16), y: value.y + (event.clientX - drag.x) * 0.18 }));
        setDrag({ x: event.clientX, y: event.clientY });
      }}
      onWheel={(event) => setZoom((value) => clamp(value - event.deltaY * 0.001, 0.82, 1.28))}
      style={{ "--avatar-rot-x": `${rotation.x}deg`, "--avatar-rot-y": `${rotation.y}deg`, "--avatar-zoom": zoom } as React.CSSProperties}
    >
      <div className="avatar-canvas-lights" />
      <Suspense fallback={<div className="avatar-loader">Cargando avatar…</div>}>
        <AvatarCharacter config={config} />
      </Suspense>
      <div className="avatar-canvas-note">Arrastrá para girar · Scroll/pinch para zoom limitado</div>
    </section>
  );
}
