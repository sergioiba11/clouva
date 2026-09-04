"use client";

import {
  ArrowLeft,
  Bot,
  Camera,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  History,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useClouvaAIAssistant } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { MainNav } from "@/components/layout";
import { VehicleModelViewer } from "@/components/auto/VehicleModelViewer";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Vehicle = {
  id: string;
  player_id: string;
  nickname: string | null;
  make: string;
  model: string;
  version: string | null;
  year: number | null;
  license_plate: string | null;
  odometer_km: number;
  fuel_type: string | null;
  transmission: string | null;
  color_current: string | null;
  notes: string | null;
};
type System = { id: string; key: string; name: string; description: string | null; progress_weight: number; sort_order: number };
type Part = {
  id: string;
  system_id: string;
  key: string;
  name: string;
  position: string | null;
  simple_description: string;
  technical_description: string | null;
  function_text: string | null;
  common_symptoms: string[];
  inspection_steps: string[];
  requirements: { tools?: string[]; consumables?: string[]; equipment?: string[]; difficulty?: string };
  safety_level: "basic" | "caution" | "specialist";
  default_priority: "low" | "normal" | "high" | "critical";
  default_repair_category: "critical" | "function" | "maintenance" | "aesthetic" | "upgrade";
  sort_order: number;
};
type PartState = {
  id: string;
  vehicle_id: string;
  part_catalog_id: string;
  status: Status;
  priority: Priority;
  notes: string | null;
  parts_cost: number;
  labor_cost: number;
  last_inspected_at: string | null;
  repaired_at: string | null;
};
type Inspection = { id: string; title: string; status: string; odometer_km: number | null; created_at: string; completed_at: string | null };
type Repair = {
  id: string;
  part_catalog_id: string | null;
  category: Part["default_repair_category"];
  status: "planned" | "in_progress" | "completed" | "cancelled";
  title: string;
  diagnosis: string | null;
  resolution: string | null;
  parts_cost: number;
  labor_cost: number;
  estimated_cost: number | null;
  created_at: string;
};
type EventItem = { id: string; event_type: string; title: string; description: string | null; amount: number | null; odometer_km: number | null; occurred_at: string };
type MediaItem = { id: string; phase: string; part_catalog_id: string | null; media: { id: string; resolved_url: string | null; caption: string | null } | null };
type Model3d = { binding: { representation_level: number; part_mesh_map: Record<string, unknown> }; asset: { id: string; name: string; model_url: string | null; preview_image_url: string | null } | null } | null;
type Payload = {
  vehicle: Vehicle;
  systems: System[];
  parts: Part[];
  states: PartState[];
  inspections: Inspection[];
  repairs: Repair[];
  events: EventItem[];
  media: MediaItem[];
  model3d: Model3d;
  costs: { parts: number; labor: number; total: number; pending: number };
};
type Status = "good" | "review" | "repair" | "replace" | "missing" | "in_progress" | "solved";
type Priority = "low" | "normal" | "high" | "critical";
type Tab = "garage" | "inspect" | "repair" | "history";

type InspectionDraft = Record<string, { result: "good" | "review"; observations: string }>;

const STATUS_LABEL: Record<Status, string> = {
  good: "Bien",
  review: "Revisar",
  repair: "Reparar",
  replace: "Cambiar",
  missing: "Falta",
  in_progress: "En proceso",
  solved: "Solucionado",
};
const PRIORITY_LABEL: Record<Priority, string> = { low: "Baja", normal: "Normal", high: "Alta", critical: "Crítica" };
const BASIC_INSPECTION_KEYS = ["front_tires", "rear_tires", "headlights", "coolant_reservoir", "engine_oil", "front_brake_pads", "battery", "front_shock_absorber"];

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "";
}
function score(status: Status | undefined) {
  if (status === "good" || status === "solved") return 1;
  if (status === "in_progress") return 0.65;
  if (status === "review" || !status) return 0.4;
  if (status === "repair") return 0.2;
  return 0;
}

export default function VehiclePage() {
  const params = useParams<{ vehicleId: string }>();
  const vehicleId = String(params.vehicleId);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { openAssistant, registerContext } = useClouvaAIAssistant();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("garage");
  const [systemId, setSystemId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [technical, setTechnical] = useState(false);
  const [inspectionDraft, setInspectionDraft] = useState<InspectionDraft>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/auto/${vehicleId}`);
      const payload = await readApiJson<Payload>(response);
      setData(payload);
      setSystemId((current) => current ?? payload.systems[0]?.id ?? null);
      setInspectionDraft((current) => {
        if (Object.keys(current).length) return current;
        return Object.fromEntries(
          payload.parts.filter((part) => BASIC_INSPECTION_KEYS.includes(part.key)).map((part) => [part.id, { result: "review" as const, observations: "" }]),
        );
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el auto.");
    } finally {
      setLoading(false);
    }
  }, [user, vehicleId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/auto/${vehicleId}`);
      return;
    }
    void load();
  }, [authLoading, load, router, user, vehicleId]);

  const stateByPart = useMemo(() => new Map((data?.states ?? []).map((state) => [state.part_catalog_id, state])), [data?.states]);
  const partById = useMemo(() => new Map((data?.parts ?? []).map((part) => [part.id, part])), [data?.parts]);
  const selectedPart = selectedPartId ? partById.get(selectedPartId) ?? null : null;
  const selectedState = selectedPart ? stateByPart.get(selectedPart.id) ?? null : null;
  const partsForSystem = useMemo(() => (data?.parts ?? []).filter((part) => part.system_id === systemId), [data?.parts, systemId]);

  const systemProgress = useMemo(() => {
    const result = new Map<string, number>();
    for (const system of data?.systems ?? []) {
      const parts = (data?.parts ?? []).filter((part) => part.system_id === system.id);
      const average = parts.length ? parts.reduce((total, part) => total + score(stateByPart.get(part.id)?.status), 0) / parts.length : 0;
      result.set(system.id, Math.round(average * 100));
    }
    return result;
  }, [data?.parts, data?.systems, stateByPart]);

  const totalProgress = useMemo(() => {
    const systems = data?.systems ?? [];
    const totalWeight = systems.reduce((sum, system) => sum + Number(system.progress_weight || 1), 0) || 1;
    return Math.round(systems.reduce((sum, system) => sum + (systemProgress.get(system.id) ?? 0) * Number(system.progress_weight || 1), 0) / totalWeight);
  }, [data?.systems, systemProgress]);

  const repairPlan = useMemo(() => {
    if (!data) return [];
    const active = new Set<Status>(["review", "repair", "replace", "missing", "in_progress"]);
    return data.states
      .filter((state) => active.has(state.status))
      .map((state) => ({ state, part: partById.get(state.part_catalog_id) }))
      .filter((entry): entry is { state: PartState; part: Part } => Boolean(entry.part))
      .sort((a, b) => {
        const priority = { critical: 4, high: 3, normal: 2, low: 1 } as const;
        return priority[b.state.priority] - priority[a.state.priority];
      });
  }, [data, partById]);

  useEffect(() => {
    if (!data) return;
    return registerContext({
      scope: "vehicle",
      id: data.vehicle.id,
      data: {
        vehicleId: data.vehicle.id,
        vehicle: `${data.vehicle.make} ${data.vehicle.model}`,
        version: data.vehicle.version,
        year: data.vehicle.year,
        odometerKm: data.vehicle.odometer_km,
        progress: totalProgress,
        selectedPart: selectedPart ? { id: selectedPart.id, key: selectedPart.key, name: selectedPart.name, status: selectedState?.status ?? "review", notes: selectedState?.notes ?? null } : null,
        repairPlan: repairPlan.slice(0, 12).map(({ part, state }) => ({ part: part.name, status: state.status, priority: state.priority })),
        costs: data.costs,
      },
    });
  }, [data, registerContext, repairPlan, selectedPart, selectedState, totalProgress]);

  function selectPartByKey(key: string) {
    const part = data?.parts.find((candidate) => candidate.key === key);
    if (part) {
      setSelectedPartId(part.id);
      setSystemId(part.system_id);
      setTechnical(false);
    }
  }

  async function savePart(form: FormData) {
    if (!selectedPart || !data) return;
    setSaving(true);
    setError(null);
    try {
      const status = String(form.get("status")) as Status;
      const response = await authenticatedFetch(`/api/auto/${vehicleId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "part_state",
          partCatalogId: selectedPart.id,
          status,
          priority: form.get("priority"),
          notes: form.get("notes"),
          partsCost: form.get("partsCost"),
          laborCost: form.get("laborCost"),
          odometerKm: data.vehicle.odometer_km,
          inspected: true,
          repaired: status === "good" || status === "solved",
          eventLabel: `${selectedPart.name}: ${STATUS_LABEL[status]}`,
        }),
      });
      await readApiJson(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la pieza.");
    } finally {
      setSaving(false);
    }
  }

  async function saveInspection() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const items = Object.entries(inspectionDraft).map(([partCatalogId, item]) => ({ partCatalogId, ...item }));
      const response = await authenticatedFetch(`/api/auto/${vehicleId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "inspection", title: "Revisión básica", odometerKm: data.vehicle.odometer_km, items }),
      });
      await readApiJson(response);
      await load();
      setTab("repair");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la revisión.");
    } finally {
      setSaving(false);
    }
  }

  async function planRepair(part: Part, state: PartState) {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/auto/${vehicleId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "repair",
          title: `${state.status === "replace" ? "Cambiar" : "Revisar / arreglar"} ${part.name}`,
          partCatalogId: part.id,
          category: state.priority === "critical" ? "critical" : part.default_repair_category,
          status: "planned",
          diagnosis: state.notes,
          estimatedCost: Number(state.parts_cost || 0) + Number(state.labor_cost || 0),
          odometerKm: data.vehicle.odometer_km,
        }),
      });
      await readApiJson(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la reparación.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>, phase = "general") {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("phase", phase);
      if (selectedPart) form.set("partCatalogId", selectedPart.id);
      const response = await authenticatedFetch(`/api/auto/${vehicleId}/media`, { method: "POST", body: form });
      await readApiJson(response);
      event.target.value = "";
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir la foto.");
    } finally {
      setUploading(false);
    }
  }

  if (loading || !data) {
    return <main className="grid min-h-screen place-items-center bg-[#05040a] text-white">{error ? <div className="max-w-md p-6 text-center"><p className="text-rose-200">{error}</p><Link href="/auto" className="mt-4 inline-block text-violet-300">Volver a Mi Garage</Link></div> : <Loader2 className="animate-spin text-violet-300" />}</main>;
  }

  const vehicleTitle = data.vehicle.nickname || `${data.vehicle.make} ${data.vehicle.model}`;

  return (
    <main className="min-h-screen bg-[#05040a] pb-28 text-white">
      <MainNav />
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-7 sm:py-7">
        <header className="flex items-center gap-3 px-1 py-2">
          <Link href="/auto" className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04]"><ArrowLeft size={18} /></Link>
          <div className="min-w-0 flex-1"><p className="truncate text-lg font-semibold">{vehicleTitle}</p><p className="truncate text-xs text-white/38">{data.vehicle.make} {data.vehicle.model}{data.vehicle.version ? ` · ${data.vehicle.version}` : ""}{data.vehicle.year ? ` · ${data.vehicle.year}` : ""}</p></div>
          <button type="button" onClick={() => openAssistant(`Estoy viendo mi ${data.vehicle.make} ${data.vehicle.model}. Explicame qué conviene revisar según el estado que tengo cargado.`)} className="grid h-10 w-10 place-items-center rounded-full border border-violet-300/20 bg-violet-300/[0.08] text-violet-200"><Bot size={18} /></button>
        </header>

        {error ? <p className="my-3 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-3 text-sm text-rose-200">{error}</p> : null}

        {tab === "garage" ? (
          <>
            <section className="relative mt-2 h-[44dvh] min-h-[330px] max-h-[560px] overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#08070c]">
              <VehicleModelViewer
                modelUrl={data.model3d?.asset?.model_url}
                partMeshMap={data.model3d?.binding.part_mesh_map}
                selectedPartKey={selectedPart?.key}
                onSelectPart={selectPartByKey}
              />
              <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md"><p className="text-[9px] uppercase tracking-[.16em] text-white/35">Gemelo digital</p><p className="mt-0.5 text-xs font-semibold">Nivel {data.model3d?.binding.representation_level ?? 1}{data.model3d?.asset ? ` · ${data.model3d.asset.name}` : " · representación genérica"}</p></div>
              <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-end justify-between"><div className="rounded-2xl border border-white/10 bg-black/60 px-3 py-2 backdrop-blur"><p className="text-[9px] uppercase tracking-[.16em] text-white/35">Reconstrucción</p><p className="text-2xl font-semibold">{totalProgress}%</p></div><p className="max-w-[155px] rounded-2xl bg-black/55 px-3 py-2 text-right text-[10px] leading-4 text-white/45 backdrop-blur">Giralo y tocá las partes disponibles.</p></div>
            </section>

            <section className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-3"><Gauge size={15} className="text-violet-300" /><p className="mt-2 text-[10px] uppercase tracking-[.12em] text-white/35">Kilómetros</p><p className="mt-1 text-sm font-semibold">{Number(data.vehicle.odometer_km).toLocaleString("es-AR")}</p></div>
              <div className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-3"><CircleDollarSign size={15} className="text-violet-300" /><p className="mt-2 text-[10px] uppercase tracking-[.12em] text-white/35">Gastado</p><p className="mt-1 text-sm font-semibold">{money(data.costs.total)}</p></div>
              <div className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-3"><Wrench size={15} className="text-violet-300" /><p className="mt-2 text-[10px] uppercase tracking-[.12em] text-white/35">Pendientes</p><p className="mt-1 text-sm font-semibold">{repairPlan.length}</p></div>
            </section>

            <section className="mt-5">
              <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
                {data.systems.map((system) => <button key={system.id} type="button" onClick={() => setSystemId(system.id)} className={`shrink-0 rounded-full border px-3.5 py-2 text-xs ${systemId === system.id ? "border-violet-300/35 bg-violet-400/15 text-violet-100" : "border-white/[0.08] bg-white/[0.03] text-white/45"}`}>{system.name} · {systemProgress.get(system.id) ?? 0}%</button>)}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {partsForSystem.map((part) => {
                  const state = stateByPart.get(part.id);
                  return <button key={part.id} type="button" onClick={() => { setSelectedPartId(part.id); setTechnical(false); }} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#0b0912] p-3 text-left"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${state?.status === "good" || state?.status === "solved" ? "bg-emerald-400" : state?.status === "repair" || state?.status === "replace" || state?.status === "missing" ? "bg-rose-400" : state?.status === "in_progress" ? "bg-amber-300" : "bg-white/25"}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{part.name}</span><span className="mt-0.5 block text-[10px] text-white/35">{STATUS_LABEL[state?.status ?? "review"]}</span></span><ChevronRight size={15} className="text-white/20" /></button>;
                })}
              </div>
            </section>

            <section className="mt-5 rounded-[26px] border border-white/[0.07] bg-[#0b0912] p-4">
              <div className="flex items-center justify-between"><div><p className="text-xs font-semibold">Fotos del auto</p><p className="mt-1 text-[11px] text-white/35">Antes, después, detalle o referencia.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs"><Camera size={14} /> {uploading ? "Subiendo…" : "Agregar"}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={uploading} onChange={(event) => void uploadPhoto(event)} /></label></div>
              {data.media.length ? <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{data.media.map((item) => item.media?.resolved_url ? <img key={item.id} src={item.media.resolved_url} alt={item.media.caption || "Foto del vehículo"} className="h-24 w-28 shrink-0 rounded-xl object-cover" /> : null)}</div> : <div className="mt-4 grid h-20 place-items-center rounded-2xl border border-dashed border-white/10 text-xs text-white/25">Todavía no cargaste fotos.</div>}
            </section>
          </>
        ) : null}

        {tab === "inspect" ? (
          <section className="mt-3">
            <div className="rounded-[26px] border border-white/[0.08] bg-[#0b0912] p-5"><div className="inline-flex items-center gap-2 text-violet-300"><Stethoscope size={18} /><span className="text-xs font-semibold uppercase tracking-[.15em]">Revisar mi auto</span></div><h2 className="mt-3 text-3xl font-semibold">Revisión básica guiada</h2><p className="mt-2 text-sm leading-6 text-white/42">Marcá lo que ves. Cada resultado queda guardado y actualiza el plan del vehículo.</p></div>
            <div className="mt-4 space-y-2">
              {data.parts.filter((part) => BASIC_INSPECTION_KEYS.includes(part.key)).map((part, index) => {
                const draft = inspectionDraft[part.id] ?? { result: "review" as const, observations: "" };
                return <article key={part.id} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.05] text-xs text-white/45">{index + 1}</span><div className="min-w-0 flex-1"><button type="button" onClick={() => setSelectedPartId(part.id)} className="text-left font-semibold">{part.name}</button><p className="mt-1 text-xs leading-5 text-white/38">{part.simple_description}</p></div></div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setInspectionDraft((current) => ({ ...current, [part.id]: { ...draft, result: "good" } }))} className={`rounded-xl px-3 py-2 text-xs font-semibold ${draft.result === "good" ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30" : "bg-white/[0.04] text-white/45"}`}>Está bien</button><button type="button" onClick={() => setInspectionDraft((current) => ({ ...current, [part.id]: { ...draft, result: "review" } }))} className={`rounded-xl px-3 py-2 text-xs font-semibold ${draft.result === "review" ? "bg-amber-300/12 text-amber-200 ring-1 ring-amber-200/25" : "bg-white/[0.04] text-white/45"}`}>Necesita revisión</button></div><input value={draft.observations} onChange={(event) => setInspectionDraft((current) => ({ ...current, [part.id]: { ...draft, observations: event.target.value } }))} placeholder="¿Qué viste o escuchaste?" className="mt-2 w-full rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-xs outline-none focus:border-violet-300/30" /></article>;
              })}
            </div>
            <button type="button" disabled={saving} onClick={() => void saveInspection()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-3.5 font-semibold disabled:opacity-50">{saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />} Guardar revisión y actualizar plan</button>
            {data.inspections.length ? <p className="mt-3 text-center text-[11px] text-white/30">Última revisión: {date(data.inspections[0].completed_at || data.inspections[0].created_at)}</p> : null}
          </section>
        ) : null}

        {tab === "repair" ? (
          <section className="mt-3">
            <div className="rounded-[26px] border border-white/[0.08] bg-[#0b0912] p-5"><div className="inline-flex items-center gap-2 text-violet-300"><Wrench size={18} /><span className="text-xs font-semibold uppercase tracking-[.15em]">Plan de reparación</span></div><h2 className="mt-3 text-3xl font-semibold">Qué necesitamos arreglar</h2><p className="mt-2 text-sm text-white/42">El orden sale del estado y prioridad que marcaste en cada pieza.</p></div>
            {!repairPlan.length ? <div className="mt-4 rounded-2xl border border-white/[0.07] bg-[#0b0912] p-7 text-center text-sm text-white/38">No hay piezas marcadas como pendientes. Hacé una revisión o tocá una pieza del auto.</div> : <div className="mt-4 space-y-2">{repairPlan.map(({ part, state }) => <article key={part.id} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><div className="flex items-start gap-3"><span className={`mt-1 h-2.5 w-2.5 rounded-full ${state.priority === "critical" ? "bg-rose-400" : state.priority === "high" ? "bg-amber-300" : "bg-violet-300"}`} /><div className="min-w-0 flex-1"><p className="font-semibold">{part.name}</p><p className="mt-1 text-xs text-white/38">{STATUS_LABEL[state.status]} · Prioridad {PRIORITY_LABEL[state.priority]}</p>{state.notes ? <p className="mt-2 text-xs leading-5 text-white/45">{state.notes}</p> : null}</div></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setSelectedPartId(part.id); setTab("garage"); }} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">Ver pieza</button><Link href={`/catalogo?q=${encodeURIComponent(part.name)}`} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs"><Search size={13} /> Buscar repuesto</Link><button type="button" disabled={saving} onClick={() => void planRepair(part, state)} className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold">Agregar reparación</button></div></article>)}</div>}

            <h3 className="mt-7 text-lg font-semibold">Reparaciones registradas</h3>
            <div className="mt-3 space-y-2">{data.repairs.length ? data.repairs.map((repair) => <article key={repair.id} className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{repair.title}</p><p className="mt-1 text-[11px] text-white/35">{repair.status === "completed" ? "Completada" : repair.status === "in_progress" ? "En proceso" : repair.status === "cancelled" ? "Cancelada" : "Planificada"} · {date(repair.created_at)}</p></div><p className="text-sm font-semibold">{money(Number(repair.parts_cost || 0) + Number(repair.labor_cost || 0))}</p></div></article>) : <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-white/25">Todavía no registraste reparaciones.</p>}</div>
          </section>
        ) : null}

        {tab === "history" ? (
          <section className="mt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><p className="text-[10px] uppercase tracking-[.13em] text-white/30">Total</p><p className="mt-1 text-xl font-semibold">{money(data.costs.total)}</p></div><div className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><p className="text-[10px] uppercase tracking-[.13em] text-white/30">Repuestos</p><p className="mt-1 text-xl font-semibold">{money(data.costs.parts)}</p></div><div className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><p className="text-[10px] uppercase tracking-[.13em] text-white/30">Mano de obra</p><p className="mt-1 text-xl font-semibold">{money(data.costs.labor)}</p></div><div className="rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><p className="text-[10px] uppercase tracking-[.13em] text-white/30">Pendiente est.</p><p className="mt-1 text-xl font-semibold">{money(data.costs.pending)}</p></div></div>
            <h2 className="mt-6 text-xl font-semibold">Historial del vehículo</h2>
            <div className="relative mt-4 space-y-2 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-white/[0.08]">{data.events.length ? data.events.map((event) => <article key={event.id} className="relative flex gap-3"><span className="relative z-10 mt-4 h-8 w-8 shrink-0 rounded-full border border-white/10 bg-[#100d17]" /><div className="flex-1 rounded-2xl border border-white/[0.07] bg-[#0b0912] p-4"><div className="flex justify-between gap-3"><p className="text-sm font-semibold">{event.title}</p><p className="text-[10px] text-white/30">{date(event.occurred_at)}</p></div>{event.description ? <p className="mt-1 text-xs text-white/40">{event.description}</p> : null}<div className="mt-2 flex gap-3 text-[10px] text-white/28">{event.odometer_km !== null ? <span>{Number(event.odometer_km).toLocaleString("es-AR")} km</span> : null}{event.amount ? <span>{money(event.amount)}</span> : null}</div></div></article>) : <p className="pl-10 text-sm text-white/30">El historial se va a construir con cada revisión y arreglo.</p>}</div>
          </section>
        ) : null}
      </div>

      <nav className="fixed bottom-3 left-1/2 z-40 flex w-[calc(100%-24px)] max-w-xl -translate-x-1/2 items-center justify-around rounded-[22px] border border-white/10 bg-[#0c0912]/95 p-1.5 shadow-2xl backdrop-blur-xl">
        {([
          ["garage", Car, "Auto"],
          ["inspect", Stethoscope, "Revisar"],
          ["repair", Wrench, "Arreglar"],
          ["history", History, "Historial"],
        ] as const).map(([key, Icon, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`flex min-w-[70px] flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[10px] ${tab === key ? "bg-violet-400/15 text-violet-200" : "text-white/38"}`}><Icon size={17} /><span>{label}</span></button>)}
      </nav>

      {selectedPart ? (
        <div className="fixed inset-0 z-[90] flex items-end bg-black/65 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPartId(null); }}>
          <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[30px] border border-white/10 bg-[#0d0a13] p-5 pb-9 sm:mx-auto sm:max-w-2xl">
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/15" />
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.16em] text-violet-300">¿Qué estoy viendo?</p><h2 className="mt-1 text-2xl font-semibold">{selectedPart.name}</h2></div><button type="button" onClick={() => setSelectedPartId(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.05]"><X size={18} /></button></div>
            <div className="mt-4 inline-flex rounded-xl bg-white/[0.04] p-1"><button type="button" onClick={() => setTechnical(false)} className={`rounded-lg px-3 py-1.5 text-xs ${!technical ? "bg-white/10 text-white" : "text-white/35"}`}>Simple</button><button type="button" onClick={() => setTechnical(true)} className={`rounded-lg px-3 py-1.5 text-xs ${technical ? "bg-white/10 text-white" : "text-white/35"}`}>Técnica</button></div>
            <p className="mt-4 text-sm leading-6 text-white/62">{technical ? selectedPart.technical_description || selectedPart.simple_description : selectedPart.simple_description}</p>
            {selectedPart.function_text ? <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-[10px] uppercase tracking-[.13em] text-white/30">Para qué sirve</p><p className="mt-2 text-sm leading-6 text-white/55">{selectedPart.function_text}</p></div> : null}

            <form action={(form) => void savePart(form)} className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <p className="text-xs font-semibold">Estado en mi auto</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <select name="status" defaultValue={selectedState?.status ?? "review"} className="rounded-xl border border-white/10 bg-[#14101c] px-3 py-2.5 text-xs"><option value="good">Bien</option><option value="review">Revisar</option><option value="repair">Reparar</option><option value="replace">Cambiar</option><option value="missing">Falta</option><option value="in_progress">En proceso</option><option value="solved">Solucionado</option></select>
                <select name="priority" defaultValue={selectedState?.priority ?? selectedPart.default_priority} className="rounded-xl border border-white/10 bg-[#14101c] px-3 py-2.5 text-xs"><option value="low">Prioridad baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option></select>
                <input name="partsCost" inputMode="decimal" defaultValue={Number(selectedState?.parts_cost || 0) || ""} placeholder="$ repuesto" className="rounded-xl border border-white/10 bg-[#14101c] px-3 py-2.5 text-xs" />
                <input name="laborCost" inputMode="decimal" defaultValue={Number(selectedState?.labor_cost || 0) || ""} placeholder="$ mano obra" className="rounded-xl border border-white/10 bg-[#14101c] px-3 py-2.5 text-xs" />
              </div>
              <textarea name="notes" defaultValue={selectedState?.notes ?? ""} placeholder="Qué viste, escuchaste o querés recordar…" rows={3} className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-[#14101c] px-3 py-2.5 text-xs outline-none focus:border-violet-300/30" />
              <button disabled={saving} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Guardar estado</button>
            </form>

            {selectedPart.common_symptoms?.length ? <div className="mt-4"><p className="text-xs font-semibold">Síntomas comunes</p><ul className="mt-2 space-y-1.5">{selectedPart.common_symptoms.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-white/45"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-violet-300" />{item}</li>)}</ul></div> : null}
            {selectedPart.inspection_steps?.length ? <div className="mt-4"><p className="text-xs font-semibold">Cómo revisarlo</p><ol className="mt-2 space-y-2">{selectedPart.inspection_steps.map((item, index) => <li key={item} className="flex gap-3 text-xs leading-5 text-white/45"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[9px]">{index + 1}</span>{item}</li>)}</ol></div> : null}
            {(selectedPart.requirements?.tools?.length || selectedPart.requirements?.consumables?.length || selectedPart.requirements?.equipment?.length) ? <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs font-semibold">¿Qué necesitarías?</p><div className="mt-2 flex flex-wrap gap-1.5">{[...(selectedPart.requirements.tools ?? []), ...(selectedPart.requirements.consumables ?? []), ...(selectedPart.requirements.equipment ?? [])].map((item) => <span key={item} className="rounded-lg bg-white/[0.05] px-2 py-1 text-[10px] text-white/45">{item}</span>)}</div></div> : null}
            {selectedPart.safety_level !== "basic" ? <div className="mt-4 flex gap-3 rounded-2xl border border-amber-200/10 bg-amber-200/[0.04] p-4"><ShieldAlert size={18} className="shrink-0 text-amber-200" /><p className="text-xs leading-5 text-amber-100/60">{selectedPart.safety_level === "specialist" ? "Esta revisión o reparación requiere herramientas/equipamiento específico y conocimiento técnico." : "Esta tarea requiere medidas de seguridad y procedimiento correcto antes de desmontar o intervenir."}</p></div> : null}

            <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => openAssistant(`Estoy viendo ${selectedPart.name} en mi ${data.vehicle.make} ${data.vehicle.model}. Explicame en simple qué revisar, usando el estado real cargado en CLOUVA Auto.`)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-3 text-xs font-semibold"><Sparkles size={14} /> Preguntar a Trébol</button><Link href={`/catalogo?q=${encodeURIComponent(selectedPart.name)}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-xs"><Search size={14} /> Repuestos</Link></div>
            <label className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-xs"><Camera size={14} /> Foto de esta pieza<input type="file" accept="image/*" capture="environment" className="hidden" disabled={uploading} onChange={(event) => void uploadPhoto(event, "inspection")} /></label>
          </div>
        </div>
      ) : null}
    </main>
  );
}
