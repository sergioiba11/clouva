"use client";

import { Clover } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CloverAIButtonProps = {
  open: boolean;
  onClick: () => void;
};

export function CloverAIButton({ open, onClick }: CloverAIButtonProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ dx: number; dy: number; moved: boolean; last: { x: number; y: number } } | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem("clouva.clover.pos");
    const fallback = { x: window.innerWidth - 76, y: Math.max(96, window.innerHeight * 0.46) };
    setPos(saved ? JSON.parse(saved) : fallback);
  }, []);
  const clamp = (x: number, y: number) => ({ x: Math.min(Math.max(12, x), window.innerWidth - 64), y: Math.min(Math.max(12 + (window.visualViewport?.offsetTop ?? 0), y), window.innerHeight - 92) });
  return (
    <button
      type="button"
      aria-label={open ? "Cerrar asistente" : "Abrir asistente"}
      aria-expanded={open}
      onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y, moved: false, last: pos }; }}
      onPointerMove={(event) => { if (!drag.current) return; event.stopPropagation(); const next = clamp(event.clientX - drag.current.dx, event.clientY - drag.current.dy); drag.current.moved = drag.current.moved || Math.abs(next.x - pos.x) > 3 || Math.abs(next.y - pos.y) > 3; drag.current.last = next; setPos(next); }}
      onPointerUp={(event) => { event.stopPropagation(); const current = drag.current; const wasDrag = current?.moved; localStorage.setItem("clouva.clover.pos", JSON.stringify(current?.last ?? pos)); drag.current = null; if (!wasDrag) onClick(); }}
      style={{ left: pos.x || undefined, top: pos.y || undefined }}
      className="clouva-ai-button group"
    >
      <span className="clouva-ai-glass" aria-hidden="true">
        <Clover className="clouva-ai-clover" strokeWidth={1.8} />
        <span className="clouva-ai-spark" />
      </span>
    </button>
  );
}
