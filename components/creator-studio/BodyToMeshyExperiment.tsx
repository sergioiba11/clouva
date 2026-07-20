"use client";

import { useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bone,
  Box,
  CheckCircle2,
  Loader2,
  Ruler,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";

type BodySection = {
  widthCm?: number;
  depthCm?: number;
  circumferenceApproxCm?: number;
};

type BodyContract = {
  version?: string;
  heightCm?: number;
  armSpanCm?: number;
  overallWidthCm?: number;
  overallDepthCm?: number;
  recommendedClearanceCm?: number;
  sections?: Record<string, BodySection>;
  garmentTarget?: Record<string, number>;
};

type StartResponse = {
  ok?: boolean;
  error?: string;
  taskId?: string;
  item?: { id?: string; name?: string };
  bodyContract?: BodyContract;
};

type MeshyStatus = {
  status?: string;
  progress?: number;
  thumbnail_url?: string;
  model_urls?: { glb?: string; fbx?: string; obj?: string };
  task_error?: { message?: string };
  error?: string;
};

type BlenderResult = {
  ok?: boolean;
  rigged?: boolean;
  warning?: string | null;
  error?: string;
  item?: { model_url?: string };
};

const CATEGORY_OPTIONS = [
  ["hoodie", "Buzo"],
  ["shirt", "Remera"],
  ["jacket", "Campera"],
  ["pants", "Pantalón"],
  ["shorts", "Short"],
  ["shoes", "Zapatillas"],
  ["accessory", "Accesorio"],
] as const;

const TERMINAL_SUCCESS = new Set(["SUCCEEDED", "SUCCESS", "COMPLETED"]);
const TERMINAL_FAILURE = new Set(["FAILED", "EXPIRED", "CANCELED", "CANCELLED"]);

function readable(value: unknown, suffix = " cm") {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}${suffix}` : "—";
}

export function BodyToMeshyExperiment() {
  const { session, user, loading } = useAuth();
  const [category, setCategory] = useState("hoodie");
  const [fit, setFit] = useState("Oversize");
  const [color, setColor] = useState("negro");
  const [name, setName] = useState("Prueba molde CLOUVA");
  const [description, setDescription] = useState("Buzo streetwear premium, capucha amplia, mangas largas, puños marcados y silueta ligeramente baggy.");
  const [running, setRunning] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [status, setStatus] = useState("Esperando que inicies la prueba.");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [contract, setContract] = useState<BodyContract | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [blenderResult, setBlenderResult] = useState<BlenderResult | null>(null);

  async function pollMeshy(nextTaskId: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(`/api/meshy/status?taskId=${encodeURIComponent(nextTaskId)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as MeshyStatus;
      if (!response.ok) throw new Error(data.error || "No se pudo consultar Meshy.");

      const normalized = String(data.status || "PENDING").toUpperCase();
      const nextProgress = Number(data.progress ?? 0);
      setProgress(Number.isFinite(nextProgress) ? Math.max(0, Math.min(100, nextProgress)) : 0);
      setStatus(`Meshy: ${normalized.toLowerCase().replaceAll("_", " ")}…`);

      if (TERMINAL_FAILURE.has(normalized)) {
        throw new Error(data.task_error?.message || `Meshy terminó con estado ${normalized}.`);
      }
      if (TERMINAL_SUCCESS.has(normalized)) {
        const nextModelUrl = data.model_urls?.glb || data.model_urls?.fbx || data.model_urls?.obj || null;
        setThumbnailUrl(data.thumbnail_url || null);
        setModelUrl(nextModelUrl);
        setProgress(100);
        setStatus(nextModelUrl
          ? "Meshy creó la pieza usando el contrato corporal. Ya podés probar el ajuste real en Blender."
          : "Meshy terminó, pero todavía no entregó una URL de modelo.");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
    }
    throw new Error("La prueba superó cinco minutos sin terminar. Podés volver a intentarla.");
  }

  async function startTest() {
    if (!session?.access_token || running) return;
    setRunning(true);
    setFinalizing(false);
    setError(null);
    setContract(null);
    setTaskId(null);
    setItemId(null);
    setThumbnailUrl(null);
    setModelUrl(null);
    setBlenderResult(null);
    setProgress(3);
    setStatus("Buscando el avatar activo…");

    try {
      const response = await fetch("/api/creator-studio/body-to-meshy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ category, fit, color, name, description }),
      });
      const data = (await response.json().catch(() => ({}))) as StartResponse;
      if (!response.ok || !data.taskId || !data.item?.id || !data.bodyContract) {
        throw new Error(data.error || "No se pudo iniciar la prueba.");
      }

      setContract(data.bodyContract);
      setTaskId(data.taskId);
      setItemId(data.item.id);
      setProgress(8);
      setStatus("Blender midió el cuerpo. Meshy está creando la pieza con esas medidas…");
      await pollMeshy(data.taskId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo ejecutar la prueba.";
      setError(message);
      setStatus("La prueba se detuvo.");
    } finally {
      setRunning(false);
    }
  }

  async function finalizeWithBlender() {
    if (!session?.access_token || !itemId || !modelUrl || finalizing) return;
    setFinalizing(true);
    setError(null);
    setBlenderResult(null);
    setStatus("Blender está colocando la pieza sobre el mismo cuerpo y transfiriendo el rig…");
    try {
      const response = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ itemId, modelUrl }),
      });
      const data = (await response.json().catch(() => ({}))) as BlenderResult;
      if (!response.ok || !data.ok) throw new Error(data.error || data.warning || "Blender no pudo terminar la prueba.");
      setBlenderResult(data);
      setStatus(data.rigged
        ? "Prueba completa: Blender midió el cuerpo, Meshy creó la pieza y Blender la riggeó sobre ese cuerpo."
        : `Meshy entregó la pieza, pero Blender no logró un rig real: ${data.warning || "sin detalle"}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo finalizar con Blender.";
      setError(message);
      setStatus("La etapa final de Blender falló.");
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#060408] text-white/60">Cargando sesión…</main>;
  }

  if (!user || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#060408] px-5 text-center text-white">
        <div><h1 className="text-2xl font-black">Necesitás iniciar sesión</h1><p className="mt-2 text-white/55">La prueba usa tu avatar activo.</p></div>
      </main>
    );
  }

  const sections = contract?.sections ?? {};
  const target = contract?.garmentTarget ?? {};

  return (
    <main className="min-h-screen bg-[#060408] pb-20 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08050c]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-violet-300"><WandSparkles className="h-4 w-4" /> Experimento CLOUVA</p>
            <h1 className="mt-1 text-lg font-black">Cuerpo → Blender → Meshy → Blender</h1>
          </div>
          <Link href="/creator-studio" className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-white/60"><ArrowLeft className="h-4 w-4" /> Volver</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[minmax(300px,.75fr)_minmax(0,1.25fr)]">
        <section className="space-y-4">
          <div className="rounded-3xl border border-violet-400/25 bg-gradient-to-br from-violet-600/20 to-transparent p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Prueba real aislada</p>
            <h2 className="mt-2 text-3xl font-black">Que Meshy conozca el cuerpo antes de crear</h2>
            <p className="mt-3 text-sm leading-6 text-white/60">Blender abre tu avatar activo, mide pecho, cintura, cadera y hombros. Después esas medidas se agregan al pedido que recibe Meshy.</p>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <label className="block"><span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/40">Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/40">Pieza</span><select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#100918] px-4 py-3 outline-none focus:border-violet-400">{CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="block"><span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/40">Calce</span><select value={fit} onChange={(event) => setFit(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#100918] px-4 py-3 outline-none focus:border-violet-400"><option>Slim</option><option>Regular</option><option>Oversize</option></select></label>
            </div>
            <label className="block"><span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/40">Color</span><input value={color} onChange={(event) => setColor(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400" /></label>
            <label className="block"><span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-white/40">Qué querés crear</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 leading-6 outline-none focus:border-violet-400" /></label>
            <button type="button" disabled={running || finalizing || !description.trim()} onClick={() => void startTest()} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-5 font-black shadow-2xl shadow-violet-950/50 disabled:opacity-50">{running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}{running ? "EJECUTANDO PRUEBA…" : "GENERAR CON EL CUERPO COMO MOLDE"}</button>
            <p className="text-center text-xs text-amber-200/65">Esta prueba llama a Meshy y puede consumir créditos.</p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-white/35">Estado</p><h2 className="mt-1 text-xl font-black">Recorrido de la prueba</h2></div><Activity className="h-6 w-6 text-violet-300" /></div>
            <p className="mt-4 text-sm leading-6 text-white/65">{status}</p>
            {(running || progress > 0) ? <div className="mt-4"><div className="mb-2 flex justify-between text-xs text-white/45"><span>{taskId ? `Meshy ${taskId.slice(0, 10)}…` : "Preparando"}</span><strong className="text-white">{Math.round(progress)}%</strong></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-400 transition-all" style={{ width: `${progress}%` }} /></div></div> : null}
            {error ? <div className="mt-4 flex gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200"><TriangleAlert className="h-5 w-5 shrink-0" /><span>{error}</span></div> : null}
          </div>

          {contract ? (
            <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/[0.055] p-5">
              <div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-400/10 p-3 text-cyan-200"><Ruler className="h-5 w-5" /></div><div><p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200/65">Contrato corporal {contract.version}</p><h2 className="text-xl font-black">Blender sí leyó el cuerpo</h2></div></div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Altura" value={readable(contract.heightCm)} />
                <Metric label="Brazos" value={readable(contract.armSpanCm)} />
                <Metric label="Pecho" value={`${readable(sections.chest?.widthCm)} × ${readable(sections.chest?.depthCm)}`} />
                <Metric label="Cintura" value={`${readable(sections.waist?.widthCm)} × ${readable(sections.waist?.depthCm)}`} />
                <Metric label="Cadera" value={`${readable(sections.hips?.widthCm)} × ${readable(sections.hips?.depthCm)}`} />
                <Metric label="Hombros" value={readable(sections.shoulders?.widthCm)} />
                <Metric label="Molde pecho" value={readable(target.chestWidthCm)} />
                <Metric label="Separación" value={readable(contract.recommendedClearanceCm)} />
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#100918]">
            <div className="flex min-h-[360px] items-center justify-center bg-black/25">
              {thumbnailUrl ? <img src={thumbnailUrl} alt="Resultado de Meshy basado en el cuerpo" className="h-full max-h-[520px] w-full object-contain" /> : <div className="px-6 text-center text-white/35"><Box className="mx-auto h-14 w-14" /><p className="mt-3 font-bold">Acá aparecerá la pieza que Meshy creó con las medidas del cuerpo.</p></div>}
            </div>
            {modelUrl ? (
              <div className="border-t border-white/10 p-4">
                <button type="button" disabled={finalizing} onClick={() => void finalizeWithBlender()} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-cyan-500 px-5 py-4 font-black text-black disabled:opacity-50">{finalizing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bone className="h-5 w-5" />}{finalizing ? "BLENDER ESTÁ AJUSTANDO…" : "PROBAR AJUSTE Y RIG REAL EN BLENDER"}</button>
              </div>
            ) : null}
          </div>

          {blenderResult ? (
            <div className={`flex gap-3 rounded-3xl border p-5 ${blenderResult.rigged ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-amber-400/30 bg-amber-500/10 text-amber-100"}`}>
              {blenderResult.rigged ? <CheckCircle2 className="h-7 w-7 shrink-0" /> : <TriangleAlert className="h-7 w-7 shrink-0" />}
              <div><h2 className="font-black">{blenderResult.rigged ? "La cadena completa funcionó" : "Meshy funcionó; el rig todavía no"}</h2><p className="mt-1 text-sm leading-6 opacity-75">{blenderResult.rigged ? "El resultado quedó guardado como prenda riggeada para el avatar activo." : blenderResult.warning || "Blender guardó la pieza sin rig automático."}</p></div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] font-black uppercase tracking-[0.11em] text-white/35">{label}</p><p className="mt-1 text-sm font-black text-white">{value}</p></div>;
}
