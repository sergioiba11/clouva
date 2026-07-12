"use client";

import { useAuth } from "@/components/auth-provider";
import { useEffect, useMemo, useState } from "react";

type Block = {
  id: string;
  name: string;
  template_key: string | null;
  start_date: string;
  duration_value: number;
  duration_unit: "days" | "hours";
  probability: number;
  steps: string[];
  steps_done: boolean[];
  notes: string | null;
};

type Template = {
  name: string;
  durVal: number;
  durUnit: "days" | "hours";
  steps: string[];
  color: string;
};

const TEMPLATES: Record<string, Template> = {
  cancion: { name: "Canción completa", durVal: 3, durUnit: "days", steps: ["Producción", "Mezcla", "Máster"], color: "#3ddc84" },
  instrumental: { name: "Instrumental + grabación casera", durVal: 2, durUnit: "hours", steps: ["Escribir", "Grabar", "Mezclar y subir"], color: "#8f7cff" },
  portada: { name: "Diseño de portada", durVal: 1, durUnit: "days", steps: ["Bocetos", "Diseño final", "Exportar"], color: "#d4af6a" },
  contenido: { name: "Plan de contenido", durVal: 2, durUnit: "days", steps: ["Ideas", "Grabar", "Editar", "Publicar"], color: "#4c9fe8" },
  custom: { name: "", durVal: 1, durUnit: "days", steps: [], color: "#8f7cff" },
};

const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const COL_W = 28;

function durationDays(b: { duration_value: number; duration_unit: string }) {
  return b.duration_unit === "hours" ? b.duration_value / 24 : b.duration_value;
}
function toDayIndex(dateStr: string, refDateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const ref = new Date(refDateStr + "T00:00:00");
  return Math.round((d.getTime() - ref.getTime()) / 86400000);
}
function fmtDate(d: Date) {
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function glowFor(level: number) {
  const shadows: Record<number, string> = {
    1: "none",
    2: "0 0 6px rgba(255,255,255,0.12)",
    3: "0 0 10px rgba(255,255,255,0.2)",
    4: "0 0 16px rgba(255,255,255,0.32)",
    5: "0 0 22px rgba(255,255,255,0.48)",
  };
  return shadows[level] || shadows[1];
}

export default function AgendaPage() {
  const { user } = useAuth();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [templateKey, setTemplateKey] = useState("cancion");
  const [name, setName] = useState(TEMPLATES.cancion.name);
  const [startDate, setStartDate] = useState(isoToday());
  const [durVal, setDurVal] = useState(TEMPLATES.cancion.durVal);
  const [durUnit, setDurUnit] = useState<"days" | "hours">(TEMPLATES.cancion.durUnit);
  const [stepsText, setStepsText] = useState(TEMPLATES.cancion.steps.join("\n"));
  const [formLevel, setFormLevel] = useState(3);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("flow_agenda_blocks").select("*").order("start_date", { ascending: true });
    setBlocks(
      (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        name: String(r.name),
        template_key: (r.template_key as string) ?? null,
        start_date: String(r.start_date),
        duration_value: Number(r.duration_value),
        duration_unit: r.duration_unit as "days" | "hours",
        probability: Number(r.probability),
        steps: (r.steps as string[]) ?? [],
        steps_done: (r.steps_done as boolean[]) ?? [],
        notes: (r.notes as string) ?? null,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [user]);

  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const t = TEMPLATES[key];
    setName(t.name);
    setDurVal(t.durVal);
    setDurUnit(t.durUnit);
    setStepsText(t.steps.join("\n"));
  };

  const createBlock = async () => {
    if (!user || !name.trim() || !startDate) return;
    setSaving(true);
    const { supabase } = await import("@/lib/supabase");
    const steps = stepsText.split("\n").map((s) => s.trim()).filter(Boolean);
    await supabase.from("flow_agenda_blocks").insert({
      owner_id: user.id,
      name: name.trim(),
      template_key: templateKey,
      start_date: startDate,
      duration_value: durVal,
      duration_unit: durUnit,
      probability: formLevel,
      steps,
      steps_done: steps.map(() => false),
    });
    setSaving(false);
    setName("");
    setStepsText("");
    void load();
  };

  const updateBlock = async (id: string, patch: Partial<Block>) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("flow_agenda_blocks").update(patch).eq("id", id);
    void load();
  };

  const deleteBlock = async (id: string) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("flow_agenda_blocks").delete().eq("id", id);
    setSelectedId(null);
    void load();
  };

  const { minDateStr, totalCols, lanes } = useMemo(() => {
    const today = new Date();
    let minD = new Date(today);
    let maxD = new Date(today);
    maxD.setDate(maxD.getDate() + 21);

    blocks.forEach((b) => {
      const s = new Date(b.start_date + "T00:00:00");
      const e = new Date(s);
      e.setDate(e.getDate() + Math.ceil(durationDays(b)));
      if (s < minD) minD = s;
      if (e > maxD) maxD = e;
    });
    minD.setDate(minD.getDate() - 1);
    maxD.setDate(maxD.getDate() + 1);

    const minDateStr = minD.toISOString().slice(0, 10);
    const totalCols = Math.round((maxD.getTime() - minD.getTime()) / 86400000);

    const sorted = [...blocks].sort((a, b) => a.start_date.localeCompare(b.start_date));
    type Lane = { endIdx: number; items: Block[] };
    const lanes: Lane[] = [];
    sorted.forEach((b) => {
      const startIdx = toDayIndex(b.start_date, minDateStr);
      const endIdx = startIdx + Math.max(durationDays(b), 0.1);
      let placed = false;
      for (const lane of lanes) {
        if (lane.endIdx <= startIdx + 0.001) {
          lane.items.push(b);
          lane.endIdx = endIdx;
          placed = true;
          break;
        }
      }
      if (!placed) lanes.push({ endIdx, items: [b] });
    });

    return { minDateStr, totalCols, lanes };
  }, [blocks]);

  const selected = blocks.find((b) => b.id === selectedId) || null;

  const toggleStep = (b: Block, i: number) => {
    const nextDone = [...(b.steps_done || [])];
    nextDone[i] = !nextDone[i];
    void updateBlock(b.id, { steps_done: nextDone } as Partial<Block>);
  };

  if (!user) return null;

  return (
    <div className="space-y-5">
      <section className="panel rounded-3xl border border-white/10 p-5">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-sm text-white/70">Planificá bloques de tareas, con duración y probabilidad. Se apilan solos si se superponen en fechas.</p>
      </section>

      <section className="panel rounded-3xl border border-[#8f7cff]/20 p-5">
        <h2 className="mb-3 text-sm uppercase tracking-[0.15em] text-white/70">Nuevo bloque</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-white/70">Plantilla</span>
            <select
              className="w-full rounded-xl border border-white/10 bg-black/30 p-2"
              value={templateKey}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="cancion">Canción completa (3 días)</option>
              <option value="instrumental">Instrumental + grabación casera (2 horas)</option>
              <option value="portada">Diseño de portada (1 día)</option>
              <option value="contenido">Plan de contenido (2 días)</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-white/70">Nombre</span>
            <input className="w-full rounded-xl border border-white/10 bg-black/30 p-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-white/70">Fecha de inicio</span>
            <input type="date" className="w-full rounded-xl border border-white/10 bg-black/30 p-2" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <div className="flex gap-2 text-sm">
            <label className="flex-1">
              <span className="mb-1 block text-white/70">Duración</span>
              <input type="number" min={0} step={0.5} className="w-full rounded-xl border border-white/10 bg-black/30 p-2" value={durVal} onChange={(e) => setDurVal(parseFloat(e.target.value) || 0)} />
            </label>
            <label className="w-28">
              <span className="mb-1 block text-white/70">Unidad</span>
              <select className="w-full rounded-xl border border-white/10 bg-black/30 p-2" value={durUnit} onChange={(e) => setDurUnit(e.target.value as "days" | "hours")}>
                <option value="days">días</option>
                <option value="hours">horas</option>
              </select>
            </label>
          </div>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-white/70">Pasos (uno por línea)</span>
            <textarea className="w-full rounded-xl border border-white/10 bg-black/30 p-2" rows={3} value={stepsText} onChange={(e) => setStepsText(e.target.value)} />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <span className="text-sm text-white/70">Probabilidad</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setFormLevel(n)}
                  className={`h-4 w-4 rounded-full border ${n <= formLevel ? "border-transparent" : "border-white/20"}`}
                  style={{ background: n <= formLevel ? "#d4af6a" : "transparent" }}
                />
              ))}
            </div>
            <button disabled={saving} onClick={createBlock} className="ml-auto rounded-full bg-[#8f7cff] px-4 py-2 text-sm font-medium text-black">
              {saving ? "Guardando..." : "+ Agregar bloque"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel rounded-3xl p-5">
        <h2 className="mb-3 text-lg font-semibold">Línea de tiempo</h2>
        {loading ? <p className="text-sm text-white/60">Cargando...</p> : null}
        {!loading && blocks.length === 0 ? <p className="text-sm text-white/60">Todavía no hay bloques. Cargá el primero arriba.</p> : null}
        {!loading && blocks.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <div style={{ width: totalCols * COL_W, position: "relative" }}>
              <div className="flex border-b border-white/10">
                {Array.from({ length: totalCols }).map((_, i) => {
                  const d = new Date(minDateStr + "T00:00:00");
                  d.setDate(d.getDate() + i);
                  const isMonthStart = d.getDate() === 1;
                  const isToday = d.toDateString() === new Date().toDateString();
                  return (
                    <div
                      key={i}
                      style={{ width: COL_W, flex: `0 0 ${COL_W}px` }}
                      className={`border-r border-white/5 py-1 text-center text-[8px] ${isMonthStart ? "text-[#8f7cff] font-semibold" : "text-white/40"} ${isToday ? "bg-white/5" : ""}`}
                    >
                      {isMonthStart ? MON[d.getMonth()] : d.getDate() % 5 === 0 ? d.getDate() : ""}
                    </div>
                  );
                })}
              </div>
              <div className="relative py-2">
                {lanes.map((lane, li) => (
                  <div key={li} className="relative" style={{ height: 42 }}>
                    {lane.items.map((b) => {
                      const startIdx = toDayIndex(b.start_date, minDateStr);
                      const left = startIdx * COL_W;
                      const width = Math.max(durationDays(b) * COL_W, 48);
                      const color = TEMPLATES[b.template_key || "custom"]?.color || "#8f7cff";
                      return (
                        <button
                          key={b.id}
                          onClick={() => setSelectedId(b.id)}
                          className={`absolute top-1 flex flex-col justify-center overflow-hidden rounded px-2 text-left text-[11px] leading-tight text-black ${b.id === selectedId ? "ring-2 ring-white" : ""}`}
                          style={{ left, width, height: 34, background: color, boxShadow: glowFor(b.probability) }}
                        >
                          <span className="truncate font-medium">{b.name}</span>
                          <span className="truncate opacity-70">
                            {b.duration_value}
                            {b.duration_unit === "hours" ? "h" : "d"} · Prob {b.probability}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel rounded-3xl p-5">
        <h2 className="mb-3 text-lg font-semibold">Detalle</h2>
        {!selected ? (
          <p className="text-sm text-white/60">Tocá un bloque de la línea de tiempo para ver el paso a paso.</p>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xl font-semibold">{selected.name}</h3>
              <span className="text-xs text-white/50">
                {fmtDate(new Date(selected.start_date + "T00:00:00"))} · {selected.duration_value}
                {selected.duration_unit === "hours" ? "h" : "d"}
              </span>
            </div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm text-white/70">Probabilidad</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => updateBlock(selected.id, { probability: n === selected.probability ? n - 1 : n } as Partial<Block>)}
                    className="h-3.5 w-3.5 rounded-full border"
                    style={{ background: n <= selected.probability ? "#d4af6a" : "transparent", borderColor: n <= selected.probability ? "#d4af6a" : "rgba(255,255,255,0.2)" }}
                  />
                ))}
              </div>
            </div>
            <ul className="space-y-2">
              {selected.steps.map((s, i) => (
                <li key={i} className="flex cursor-pointer items-center gap-2 text-sm" onClick={() => toggleStep(selected, i)}>
                  <input type="checkbox" readOnly checked={!!selected.steps_done[i]} />
                  <span className={selected.steps_done[i] ? "text-white/50 line-through" : ""}>{s}</span>
                </li>
              ))}
            </ul>
            <button onClick={() => deleteBlock(selected.id)} className="mt-4 rounded-full border border-red-400/40 px-3 py-1.5 text-xs text-red-300">
              Eliminar bloque
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
