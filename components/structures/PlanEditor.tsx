"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save, Trash2, Undo2 } from "lucide-react";

type PlanPoint = { x: number; y: number };
type Blockout = { height?: number; footprint?: PlanPoint[] };

const WIDTH = 720;
const HEIGHT = 440;
const SCALE = 10;
const GRID = 20;

function screenToLocal(clientX: number, clientY: number, rect: DOMRect): PlanPoint {
  const sx = ((clientX - rect.left) / rect.width) * WIDTH;
  const sy = ((clientY - rect.top) / rect.height) * HEIGHT;
  const x = Math.round(((sx - WIDTH / 2) / SCALE) * 2) / 2;
  const y = Math.round((((HEIGHT / 2) - sy) / SCALE) * 2) / 2;
  return { x, y };
}

function toScreen(point: PlanPoint) {
  return {
    x: WIDTH / 2 + point.x * SCALE,
    y: HEIGHT / 2 - point.y * SCALE,
  };
}

export function PlanEditor({
  initialBlockout,
  saving,
  onSave,
}: {
  initialBlockout: Blockout;
  saving: boolean;
  onSave: (blockout: Blockout) => Promise<void>;
}) {
  const [points, setPoints] = useState<PlanPoint[]>(
    Array.isArray(initialBlockout.footprint) ? initialBlockout.footprint : [],
  );
  const [height, setHeight] = useState(
    Number(initialBlockout.height) > 0 ? String(initialBlockout.height) : "",
  );

  useEffect(() => {
    setPoints(Array.isArray(initialBlockout.footprint) ? initialBlockout.footprint : []);
    setHeight(Number(initialBlockout.height) > 0 ? String(initialBlockout.height) : "");
  }, [initialBlockout]);

  const polyline = useMemo(
    () => points.map((point) => {
      const screen = toScreen(point);
      return `${screen.x},${screen.y}`;
    }).join(" "),
    [points],
  );

  const closedPolygon = points.length >= 3 ? `${polyline} ${polyline.split(" ")[0]}` : polyline;

  function addPoint(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToLocal(event.clientX, event.clientY, rect);
    setPoints((current) => [...current, point]);
  }

  async function save() {
    const numericHeight = height.trim() ? Number(height) : undefined;
    await onSave({
      footprint: points,
      ...(numericHeight && numericHeight > 0 ? { height: numericHeight } : {}),
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#07050b]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Plano relativo</p>
            <p className="mt-0.5 text-xs text-white/40">Tocá el plano para marcar el perímetro. La grilla usa unidades locales de 1 m.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPoints((current) => current.slice(0, -1))}
              disabled={!points.length}
              className="rounded-full border border-white/10 p-2 text-white/60 disabled:opacity-30"
              title="Deshacer último punto"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPoints([])}
              disabled={!points.length}
              className="rounded-full border border-white/10 p-2 text-white/60 disabled:opacity-30"
              title="Limpiar perímetro"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="aspect-[18/11] w-full cursor-crosshair select-none bg-[#05030a]"
          onClick={addPoint}
        >
          <defs>
            <pattern id="structure-grid-small" width={GRID / 2} height={GRID / 2} patternUnits="userSpaceOnUse">
              <path d={`M ${GRID / 2} 0 L 0 0 0 ${GRID / 2}`} fill="none" stroke="#241d30" strokeWidth="0.5" />
            </pattern>
            <pattern id="structure-grid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
              <rect width={GRID * 5} height={GRID * 5} fill="url(#structure-grid-small)" />
              <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke="#443653" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#structure-grid)" />
          <line x1={WIDTH / 2} y1="0" x2={WIDTH / 2} y2={HEIGHT} stroke="#6d28d9" strokeOpacity="0.35" />
          <line x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="#6d28d9" strokeOpacity="0.35" />

          {points.length >= 2 ? (
            <polyline
              points={closedPolygon}
              fill={points.length >= 3 ? "#7c3aed22" : "none"}
              stroke="#c4b5fd"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {points.map((point, index) => {
            const screen = toScreen(point);
            return (
              <g key={`${point.x}-${point.y}-${index}`}>
                <circle cx={screen.x} cy={screen.y} r="6" fill="#ffffff" stroke="#7c3aed" strokeWidth="3" />
                <text x={screen.x + 9} y={screen.y - 9} fill="#ffffff" fontSize="10">
                  {index + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Blockout</p>
        <h3 className="mt-2 text-lg font-semibold">Geometría manual</h3>
        <p className="mt-2 text-sm leading-5 text-white/45">
          CLOUVA solo guarda las medidas que marques. No completa dimensiones reales por su cuenta.
        </p>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs text-white/45">Altura conocida en metros</span>
          <input
            type="number"
            min="0.5"
            max="30"
            step="0.1"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            placeholder="Sin dato"
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/50"
          />
        </label>

        <div className="mt-5 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs">
          <div className="flex justify-between"><span className="text-white/40">Puntos</span><span>{points.length}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Perímetro</span><span>{points.length >= 3 ? "cerrado al guardar" : "incompleto"}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Origen</span><span>centro 0,0</span></div>
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || points.length < 3}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Save className="h-4 w-4" />
          {saving ? "Guardando…" : "Guardar plano"}
        </button>

        <button
          type="button"
          onClick={() => {
            setPoints(Array.isArray(initialBlockout.footprint) ? initialBlockout.footprint : []);
            setHeight(Number(initialBlockout.height) > 0 ? String(initialBlockout.height) : "");
          }}
          className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-white/10 text-sm text-white/60"
        >
          <RotateCcw className="h-4 w-4" />
          Restaurar guardado
        </button>
      </aside>
    </div>
  );
}
