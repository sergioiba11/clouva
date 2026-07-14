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
const VIEW_LABELS: Record<Side, { title: string; subtitle: string }> = {
  front: { title: "Frente", subtitle: "Portada oficial" },
  back: { title: "Espalda", subtitle: "Mismo diseño" },
  side: { title: "Lateral", subtitle: "Volumen y calce" },
};

type Side = "front" | "back" | "side";
type Measurements = { height: number; width: number; depth: number; slotWidth: number; slotHeight: number; slotDepth: number };
type Phase = "idle" | "measuring" | "designing" | "review" | "uploading" | "generating" | "saving" | "done" | "error";

async function measureAvatar(url: string, category: string): Promise<Measurements> {
  const avatar = (await new GLTFLoader().loadAsync(url)).scene;
  normalizeAvatarObject(avatar, { targetHeight: 2.05 });
  avatar.updateMatrixWorld(true);
  const full = new Box3().setFromObject(avatar).getSize(new Vector3());
  const part = BODY_MESHES[category] ? findAvatarBodyPart(avatar, BODY_MESHES[category]) : null;
  const slot = part ? part.box.getSize(new Vector3()) : full;
  return { height: full.y, width: full.x, depth: full.z, slotWidth: slot.x, slotHeight: slot.y, slotDepth: slot.z };
}

async function urlToFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("No se pudo descargar la referencia generada");
  return new File([await response.blob()], filename, { type: "image/png" });
}

export default function GarmentFlowClient() {
  const { session } = useAuth();
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const [category, setCategory] = useState("hoodie");
  const [name, setName] = useState("");
  const [fit, setFit] = useState("Oversized");
  const [color, setColor] = useState("#0a0a0a");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurements | null>(null);
  const [files, setFiles] = useState<Record<Side, File | null>>({ front: null, back: null, side: null });
  const [previews, setPreviews] = useState<Record<Side, string | null>>({ front: null, back: null, side: null });
  const [result, setResult] = useState<{ id: string; modelUrl: string } | null>(null);
  const busy = ["measuring", "designing", "uploading", "generating", "saving"].includes(phase);
  const hasReferences = Boolean(previews.front && previews.back && previews.side);
  const selectedCategory = CATEGORIES.find(([value]) => value === category)?.[1] ?? "Pieza";

  const invalidateDesign = () => {
    if (!hasReferences || busy) return;
    setFiles({ front: null, back: null, side: null });
    setPreviews({ front: null, back: null, side: null });
    setMeasurements(null);
    setPhase("idle");
    setProgress(0);
  };

  const generateDesign = async () => {
    setError(null);
    try {
      if (!session?.access_token) throw new Error("Iniciá sesión.");
      if (!avatar.modelUrl) throw new Error("No hay un avatar GLB activo.");
      if (!name.trim()) throw new Error("Poné un nombre para identificar la pieza.");
      if (!description.trim()) throw new Error("Describí cómo querés que sea la pieza.");
      setPhase("measuring");
      const measured = await measureAvatar(avatar.modelUrl, category);
      setMeasurements(measured);
      setPhase("designing");
      const response = await fetch("/api/clothing/design-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ category, name, fit, color, description, measurements: measured }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "No se pudo generar el diseño.");
      const [front, back, side] = await Promise.all([
        urlToFile(data.references.front, "front.png"),
        urlToFile(data.references.back, "back.png"),
        urlToFile(data.references.side, "side.png"),
      ]);
      setFiles({ front, back, side });
      setPreviews({ front: data.references.front, back: data.references.back, side: data.references.side });
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      setPhase("error");
    }
  };

  const poll = async (taskId: string) => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const response = await fetch(`/api/meshy/status?taskId=${taskId}&kind=multi-image`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (typeof data.progress === "number") setProgress(data.progress);
      if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(data.status)) return data;
    }
  };

  const generate3D = async () => {
    setError(null); setProgress(0);
    try {
      if (!session?.access_token || !files.front || !files.back || !files.side) throw new Error("Primero generá y aprobá las tres vistas.");
      setPhase("uploading");
      const form = new FormData();
      form.append("front", files.front); form.append("back", files.back); form.append("side", files.side);
      form.append("category", category); form.append("name", name || "Prenda CLOUVA");
      form.append("fit", fit); form.append("color", color); form.append("description", description);
      form.append("coverSource", "openai");
      if (measurements) form.append("measurements", JSON.stringify(measurements));
      const createResponse = await fetch("/api/clothing/create", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error) throw new Error(created.error || "No se pudo iniciar Meshy.");
      setPhase("generating");
      const generated = await poll(created.taskId);
      if (generated.status !== "SUCCEEDED" || !generated.model_urls?.glb) throw new Error(generated.task_error?.message || "Meshy no pudo crear el objeto.");
      setPhase("saving");
      const saveResponse = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ itemId: created.item.id, modelUrl: generated.model_urls.glb }),
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

  const upload = (side: Side) => {
    const label = VIEW_LABELS[side];
    return <label className="group relative block cursor-pointer overflow-hidden rounded-2xl border border-dashed border-white/15 bg-black/30 text-center transition hover:border-violet-400/60">
      {previews[side] ? <img src={previews[side]!} alt={label.title} className="aspect-[4/5] w-full object-contain p-2" /> : <div className="grid aspect-[4/5] place-items-center p-3"><div><p className="text-sm font-medium text-white/75">{label.title}</p><p className="mt-1 text-[11px] text-white/35">{label.subtitle}</p><p className="mt-4 text-[10px] text-violet-300/70">Subir manualmente</p></div></div>}
      {previews[side] ? <div className="absolute inset-x-2 bottom-2 rounded-lg bg-black/70 px-2 py-1.5 backdrop-blur"><p className="text-[11px] font-medium">{label.title}</p><p className="text-[9px] text-white/50">{label.subtitle}</p></div> : null}
      <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => {
        const file = e.target.files?.[0] || null;
        setFiles((v) => ({ ...v, [side]: file }));
        setPreviews((v) => ({ ...v, [side]: file ? URL.createObjectURL(file) : null }));
        if (file) setPhase("review");
      }} />
    </label>;
  };

  const designButtonText = phase === "measuring" ? "Analizando el GLB…" : phase === "designing" ? "Creando la prenda completa…" : hasReferences ? "Regenerar las 3 vistas" : "Generar diseño con IA";
  const meshButtonText = phase === "uploading" ? "Preparando referencias…" : phase === "generating" ? `Creando objeto 3D · ${progress}%` : phase === "saving" ? "Guardando pieza y portada…" : "Aprobar diseño y crear pieza 3D";

  return <main className="mx-auto min-h-screen w-full max-w-2xl px-3 pb-28 pt-4 text-white sm:px-5">
    <div className="mb-4 flex items-center justify-between"><Link href="/mi-flow/avatar" className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60">← Avatar</Link><span className="text-[10px] uppercase tracking-[0.25em] text-violet-300/60">CLOUVA CREATOR</span><Link href="/mi-flow/armario" className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60">Armario</Link></div>
    {!result ? <section className="overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-violet-500/[0.08] to-black/20 shadow-2xl shadow-black/30">
      <div className="border-b border-white/10 p-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-violet-300">Nueva pieza 3D</p>
        <h1 className="text-2xl font-semibold leading-tight">Diseñá la pieza. CLOUVA hace el molde.</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/45">La categoría crea la forma completa. Tu descripción define el flow. OpenAI prepara las vistas y Meshy genera el GLB.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] text-white/45">
          <div className={`rounded-xl border p-2 ${!hasReferences ? "border-violet-400/50 bg-violet-400/10 text-white" : "border-white/10"}`}><b className="block text-xs">1</b>Diseño</div>
          <div className={`rounded-xl border p-2 ${hasReferences && phase !== "done" ? "border-violet-400/50 bg-violet-400/10 text-white" : "border-white/10"}`}><b className="block text-xs">2</b>Revisión</div>
          <div className={`rounded-xl border p-2 ${["uploading", "generating", "saving"].includes(phase) ? "border-violet-400/50 bg-violet-400/10 text-white" : "border-white/10"}`}><b className="block text-xs">3</b>Modelo 3D</div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div><p className="mb-2 text-xs font-medium text-white/60">¿Qué pieza querés crear?</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{CATEGORIES.map(([value, label]) => <button key={value} disabled={busy} onClick={() => { invalidateDesign(); setCategory(value); }} className={`min-h-11 rounded-xl border px-3 py-2 text-sm transition ${category === value ? "border-violet-400 bg-violet-400/15 text-white" : "border-white/10 bg-black/15 text-white/55"}`}>{label}</button>)}</div></div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <label className="block"><span className="mb-1.5 block text-xs text-white/55">Nombre de la pieza</span><input value={name} disabled={busy} onChange={(e) => { invalidateDesign(); setName(e.target.value); }} placeholder={`Ej: ${selectedCategory} Clover 01`} className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm outline-none focus:border-violet-400/60" /></label>
          <div><span className="mb-1.5 block text-xs text-white/55">Color base</span><div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-2"><input aria-label="Color base" type="color" value={color} disabled={busy} onChange={(e) => { invalidateDesign(); setColor(e.target.value); }} className="h-10 w-14 cursor-pointer rounded-lg bg-transparent"/><span className="font-mono text-xs uppercase text-white/50">{color}</span></div></div>
          <div><span className="mb-2 block text-xs text-white/55">Calce</span><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{FITS.map((item) => <button key={item} disabled={busy} onClick={() => { invalidateDesign(); setFit(item); }} className={`rounded-xl border px-2 py-2.5 text-xs ${fit === item ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/55"}`}>{item}</button>)}</div></div>
          <label className="block"><span className="mb-1.5 block text-xs text-white/55">Describí el diseño</span><textarea value={description} disabled={busy} onChange={(e) => { invalidateDesign(); setDescription(e.target.value); }} rows={5} maxLength={600} placeholder="Ej: hoodie oversized negro, capucha profunda, mangas anchas, logo CLOUVA pequeño al frente y trébol violeta grande atrás…" className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed outline-none focus:border-violet-400/60" /><p className="mt-1 text-right text-[10px] text-white/30">{description.length}/600</p></label>
        </div>

        <button onClick={generateDesign} disabled={busy} className="w-full rounded-2xl bg-violet-400 py-4 text-sm font-bold text-black shadow-lg shadow-violet-500/20 disabled:opacity-50">{designButtonText}</button>

        {measurements ? <div className="flex items-center justify-between rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-2.5 text-xs"><span className="text-emerald-300">✓ Molde del avatar analizado</span><span className="font-mono text-white/40">{measurements.slotWidth.toFixed(2)} × {measurements.slotHeight.toFixed(2)} × {measurements.slotDepth.toFixed(2)} m</span></div> : null}

        <div>
          <div className="mb-3 flex items-end justify-between"><div><p className="text-sm font-medium">Vistas para el modelo 3D</p><p className="mt-0.5 text-[11px] text-white/40">Las tres deben mostrar la misma pieza completa.</p></div>{hasReferences ? <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">Listas ✓</span> : null}</div>
          <div className="grid grid-cols-3 gap-2">{upload("front")}{upload("back")}{upload("side")}</div>
          {previews.front ? <p className="mt-2 text-[10px] text-white/35">La vista frontal se guarda automáticamente como portada de la pieza en tu base general.</p> : null}
        </div>

        {hasReferences ? <button onClick={generate3D} disabled={busy} className="w-full rounded-2xl bg-white py-4 text-sm font-bold text-black disabled:opacity-50">{meshButtonText}</button> : <div className="rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-white/35">Primero generá y revisá las tres vistas.</div>}
        {phase === "generating" ? <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${Math.max(2, progress)}%` }} /></div> : null}
        {error ? <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.08] p-3 text-sm text-rose-300">{error}</div> : null}
      </div>
    </section> : <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4"><p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Pieza guardada</p><h1 className="mt-1 text-2xl font-semibold">{name || "Objeto 3D listo"} ✓</h1></div>
      <div className="h-[430px] overflow-hidden rounded-2xl border border-white/10 bg-black/40"><OutfitPreview avatarUrl={avatar.modelUrl} layers={[{ id: result.id, url: result.modelUrl, visible: true, category }]} /></div>
      <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => { setResult(null); setPhase("review"); }} className="rounded-2xl border border-white/15 py-3 text-sm">Regenerar</button><Link href="/mi-flow/armario" className="rounded-2xl bg-violet-400 py-3 text-center text-sm font-semibold text-black">Ver en armario</Link></div>
    </section>}
  </main>;
}
