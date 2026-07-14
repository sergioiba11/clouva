"use client";

import { useState } from "react";
import Link from "next/link";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { OutfitPreview } from "@/components/avatar-engine/OutfitPreview";
import { findAvatarBodyPart, normalizeAvatarObject } from "@/lib/avatar-engine/frame-avatar";

const CATEGORIES = [
  ["hoodie", "Buzo"], ["shirt", "Remera"], ["jacket", "Campera"],
  ["pants", "Pantalón baggy"], ["shorts", "Short"], ["shoes", "Zapatillas"], ["accessory", "Accesorio"],
] as const;
const FITS = ["Entallado", "Normal", "Oversized", "Baggy"];
const BODY_MESHES: Record<string, string[]> = {
  hoodie: ["Casual_Body"], shirt: ["Casual_Body"], jacket: ["Casual_Body"],
  pants: ["Casual_Legs"], shorts: ["Casual_Legs"], shoes: ["Casual_Feet"],
};
type Measurements = { height: number; width: number; depth: number; slotWidth: number; slotHeight: number; slotDepth: number };
type Phase = "idle" | "measuring" | "previewing" | "refining" | "saving" | "done" | "error";

async function measureAvatar(url: string, category: string): Promise<Measurements> {
  const avatar = (await new GLTFLoader().loadAsync(url)).scene;
  normalizeAvatarObject(avatar, { targetHeight: 2.05 });
  avatar.updateMatrixWorld(true);
  const full = new Box3().setFromObject(avatar).getSize(new Vector3());
  const part = BODY_MESHES[category] ? findAvatarBodyPart(avatar, BODY_MESHES[category]) : null;
  const slot = part ? part.box.getSize(new Vector3()) : full;
  return { height: full.y, width: full.x, depth: full.z, slotWidth: slot.x, slotHeight: slot.y, slotDepth: slot.z };
}

export default function GarmentFlowClient() {
  const { session } = useAuth();
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const [category, setCategory] = useState("hoodie");
  const [name, setName] = useState("");
  const [fit, setFit] = useState("Oversized");
  const [color, setColor] = useState("#0a0a0a");
  const [description, setDescription] = useState("");
  const [textureDetails, setTextureDetails] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurements | null>(null);
  const [result, setResult] = useState<{ id: string; modelUrl: string } | null>(null);
  const busy = ["measuring", "previewing", "refining", "saving"].includes(phase);

  const poll = async (taskId: string) => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const response = await fetch(`/api/meshy/status?taskId=${taskId}`);
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "No se pudo consultar Meshy");
      if (typeof data.progress === "number") setProgress(data.progress);
      if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(data.status)) return data;
    }
  };

  const generate3D = async () => {
    setError(null);
    setProgress(0);
    try {
      if (!session?.access_token) throw new Error("Iniciá sesión.");
      if (!avatar.modelUrl) throw new Error("No hay un avatar GLB activo.");
      if (!name.trim()) throw new Error("Poné un nombre para la pieza.");
      if (!description.trim()) throw new Error("Describí la forma de la pieza.");

      setPhase("measuring");
      const measured = await measureAvatar(avatar.modelUrl, category);
      setMeasurements(measured);

      const createResponse = await fetch("/api/clothing/create-text", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ category, name, fit, color, description, textureDetails, measurements: measured }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error) throw new Error(created.error || "No se pudo iniciar Meshy.");

      setPhase("previewing");
      const preview = await poll(created.taskId);
      if (preview.status !== "SUCCEEDED") throw new Error(preview.task_error?.message || "Meshy no pudo crear la geometría inicial.");

      setPhase("refining");
      setProgress(0);
      const refineResponse = await fetch("/api/meshy/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewTaskId: created.taskId }),
      });
      const refinedTask = await refineResponse.json();
      if (!refineResponse.ok || refinedTask.error) throw new Error(refinedTask.error || "No se pudo refinar la pieza.");

      const refined = await poll(refinedTask.taskId);
      if (refined.status !== "SUCCEEDED" || !refined.model_urls?.glb) throw new Error(refined.task_error?.message || "Meshy no devolvió el GLB.");

      setPhase("saving");
      const saveResponse = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ itemId: created.item.id, modelUrl: refined.model_urls.glb, thumbnailUrl: refined.thumbnail_url || preview.thumbnail_url || null }),
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok || saved.error || !saved.item?.model_url) throw new Error(saved.error || "No se pudo guardar el GLB.");

      setResult({ id: saved.item.id, modelUrl: saved.item.model_url });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      setPhase("error");
    }
  };

  const buttonText = phase === "measuring" ? "Analizando el GLB del avatar…" : phase === "previewing" ? `Meshy creando la forma · ${progress}%` : phase === "refining" ? `Meshy aplicando textura y refinando · ${progress}%` : phase === "saving" ? "Guardando la pieza…" : "Crear objeto 3D";

  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 text-white">
    <div className="mb-4 flex items-center justify-between"><Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link><span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-[10px] tracking-[0.18em] text-violet-200">MESHY 3D</span></div>

    {!result ? <section className="rounded-[28px] border border-white/10 bg-white/[0.035] p-4 sm:p-6">
      <div className="mb-5"><p className="mb-1 text-xs font-medium uppercase tracking-[0.22em] text-violet-300">Nueva pieza</p><h1 className="text-2xl font-semibold leading-tight">Crear directamente sobre el molde del avatar</h1><p className="mt-2 text-sm leading-relaxed text-white/45">Sin OpenAI. Meshy crea la forma con las medidas del GLB y después aplica color y textura.</p></div>

      <div className="mb-5 grid grid-cols-3 gap-2">{CATEGORIES.map(([value, label]) => <button key={value} disabled={busy} onClick={() => setCategory(value)} className={`min-h-12 rounded-2xl border px-2 py-2 text-xs ${category === value ? "border-violet-400 bg-violet-400/15 text-white" : "border-white/10 bg-black/15 text-white/55"}`}>{label}</button>)}</div>

      <div className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-3">
        <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la pieza" className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-sm outline-none" />
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 p-3"><div><p className="text-sm">Color base</p><p className="text-[11px] text-white/35">Material principal</p></div><input aria-label="Color base" type="color" value={color} disabled={busy} onChange={(e) => setColor(e.target.value)} className="h-11 w-14 bg-transparent" /></div>
        <div className="grid grid-cols-4 gap-2">{FITS.map((item) => <button key={item} disabled={busy} onClick={() => setFit(item)} className={`rounded-xl border px-2 py-2 text-[11px] ${fit === item ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/50"}`}>{item}</button>)}</div>
        <label className="block"><span className="mb-1.5 block text-xs text-white/55">Forma de la pieza</span><textarea value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={600} placeholder="Ej: hoodie oversized, capucha profunda, mangas anchas, bolsillo canguro, puños ajustados…" className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-4 text-sm outline-none" /></label>
        <label className="block"><span className="mb-1.5 block text-xs text-white/55">Textura y detalles opcionales</span><textarea value={textureDetails} disabled={busy} onChange={(e) => setTextureDetails(e.target.value)} rows={4} maxLength={400} placeholder="Ej: algodón pesado mate, costuras violetas, logo pequeño bordado adelante, estampado grande atrás…" className="w-full resize-none rounded-2xl border border-violet-400/20 bg-violet-400/[0.04] p-4 text-sm outline-none" /><p className="mt-1 text-[10px] text-white/30">Los detalles se aplican a la superficie; no cambian la forma del objeto.</p></label>
      </div>

      <button onClick={generate3D} disabled={busy} className="my-4 w-full rounded-2xl bg-violet-400 py-4 font-semibold text-black disabled:opacity-50">{buttonText}</button>
      {measurements ? <div className="mb-4 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] px-4 py-3 text-xs"><span className="text-emerald-300">✓ Molde analizado</span><span className="ml-2 text-white/45">{measurements.slotWidth.toFixed(2)} × {measurements.slotHeight.toFixed(2)} × {measurements.slotDepth.toFixed(2)} m</span></div> : null}
      {busy ? <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-violet-400 transition-all" style={{ width: `${Math.max(3, progress)}%` }} /></div> : null}
      {error ? <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.08] p-3 text-sm text-rose-300">{error}</p> : null}
    </section> : <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <h1 className="mb-3 text-xl font-semibold">Objeto 3D listo ✓</h1>
      <div className="h-[430px] overflow-hidden rounded-2xl border border-white/10 bg-black/40"><OutfitPreview avatarUrl={avatar.modelUrl} layers={[{ id: result.id, url: result.modelUrl, visible: true, category }]} /></div>
      <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => { setResult(null); setPhase("idle"); }} className="rounded-2xl border border-white/15 py-3 text-sm">Crear otra</button><Link href="/mi-flow/armario" className="rounded-2xl bg-violet-400 py-3 text-center text-sm font-semibold text-black">Ver en armario</Link></div>
    </section>}
  </main>;
}
