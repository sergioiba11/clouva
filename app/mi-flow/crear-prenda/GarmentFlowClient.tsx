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
  const referencesReady = Boolean(files.front && files.back && files.side);

  const invalidateDesign = () => {
    if (previews.front || previews.back || previews.side) {
      setFiles({ front: null, back: null, side: null });
      setPreviews({ front: null, back: null, side: null });
      setMeasurements(null);
      setPhase("idle");
    }
  };

  const generateDesign = async () => {
    setError(null);
    try {
      if (!session?.access_token) throw new Error("Iniciá sesión.");
      if (!avatar.modelUrl) throw new Error("No hay un avatar GLB activo.");
      if (!description.trim()) throw new Error("Describí cómo querés la pieza.");
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
      if (!session?.access_token || !files.front || !files.back || !files.side) throw new Error("Necesitás aprobar frente, espalda y lateral.");
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

  const upload = (side: Side, label: string, subtitle: string) => <label className="relative block cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-2 text-center">
    <div className="mb-2 flex items-center justify-between px-1"><span className="text-xs font-medium">{label}</span><span className="text-[10px] text-white/35">{subtitle}</span></div>
    {previews[side] ? <img src={previews[side]!} alt={label} className="aspect-square w-full rounded-xl bg-white/5 object-contain" /> : <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-white/10 text-xs text-white/35">Se genera con IA<br/>o tocá para reemplazar</div>}
    <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => {
      const file = e.target.files?.[0] || null;
      setFiles((v) => ({ ...v, [side]: file }));
      setPreviews((v) => ({ ...v, [side]: file ? URL.createObjectURL(file) : null }));
      if (file) setPhase("review");
    }} />
  </label>;

  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 text-white">
    <div className="mb-4 flex items-center justify-between"><Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link><span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-[10px] tracking-[0.18em] text-violet-200">CREADOR 3D</span></div>
    {!result ? <section className="rounded-[28px] border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-violet-950/20 sm:p-6">
      <div className="mb-5"><p className="mb-1 text-xs font-medium uppercase tracking-[0.22em] text-violet-300">Nueva pieza</p><h1 className="text-2xl font-semibold leading-tight">Diseñá una pieza para tu avatar</h1><p className="mt-2 text-sm leading-relaxed text-white/45">Elegís la forma. OpenAI crea las vistas. Meshy construye el objeto 3D.</p></div>
      <div className="mb-5 grid grid-cols-3 gap-2">{CATEGORIES.map(([value, label]) => <button key={value} onClick={() => { invalidateDesign(); setCategory(value); }} className={`min-h-12 rounded-2xl border px-2 py-2 text-xs ${category === value ? "border-violet-400 bg-violet-400/15 text-white" : "border-white/10 bg-black/15 text-white/55"}`}>{label}</button>)}</div>
      <div className="space-y-3 rounded-3xl border border-white/8 bg-black/20 p-3">
        <input value={name} onChange={(e) => { invalidateDesign(); setName(e.target.value); }} placeholder="Nombre de la pieza" className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-sm outline-none focus:border-violet-400/70" />
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 p-3"><div><p className="text-sm">Color base</p><p className="text-[11px] text-white/35">Define el material principal</p></div><input aria-label="Color base" type="color" value={color} onChange={(e) => { invalidateDesign(); setColor(e.target.value); }} className="h-11 w-14 rounded-xl border-0 bg-transparent" /></div>
        <div className="grid grid-cols-4 gap-2">{FITS.map((item) => <button key={item} onClick={() => { invalidateDesign(); setFit(item); }} className={`rounded-xl border px-2 py-2 text-[11px] ${fit === item ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/50"}`}>{item}</button>)}</div>
        <textarea value={description} onChange={(e) => { invalidateDesign(); setDescription(e.target.value); }} rows={5} placeholder="Describí la pieza completa: forma, materiales, bolsillos, capucha, logo adelante, diseño atrás..." className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-4 text-sm outline-none focus:border-violet-400/70" />
      </div>
      <button onClick={generateDesign} disabled={busy} className="my-4 w-full rounded-2xl bg-violet-400 py-4 font-semibold text-black transition disabled:opacity-50">{phase === "measuring" ? "1/3 Analizando el GLB…" : phase === "designing" ? "2/3 Creando las tres vistas…" : previews.front ? "Regenerar las tres vistas" : "Generar diseño con IA"}</button>
      {measurements ? <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3 text-xs"><span className="text-white/45">Molde detectado</span><span className="font-medium text-white/70">{measurements.slotWidth.toFixed(2)} × {measurements.slotHeight.toFixed(2)} × {measurements.slotDepth.toFixed(2)} m</span></div> : null}
      <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-medium">Referencias para Meshy</p><p className="text-[11px] text-white/35">Las tres deben mostrar la misma pieza completa</p></div>{referencesReady ? <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] text-emerald-300">LISTAS</span> : null}</div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">{upload("front", "Frente", "PORTADA")}{upload("back", "Espalda", "VISTA 2")}{upload("side", "Lateral", "VISTA 3")}</div>
      {previews.front || previews.back || previews.side ? <button onClick={generate3D} disabled={busy || !referencesReady} className="w-full rounded-2xl bg-white py-4 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-30">{phase === "uploading" ? "Preparando referencias…" : phase === "generating" ? `Meshy está creando el 3D · ${progress}%` : phase === "saving" ? "Guardando pieza y portada…" : referencesReady ? "Aprobar vistas y crear objeto 3D" : "Falta completar las tres vistas"}</button> : null}
      {error ? <p className="mt-3 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p> : null}
    </section> : <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <h1 className="mb-3 text-xl font-semibold">Objeto 3D listo ✓</h1>
      <div className="h-[430px] overflow-hidden rounded-2xl border border-white/10 bg-black/40"><OutfitPreview avatarUrl={avatar.modelUrl} layers={[{ id: result.id, url: result.modelUrl, visible: true, category }]} /></div>
      <button onClick={() => { setResult(null); setPhase("review"); }} className="mt-3 w-full rounded-2xl border border-white/15 py-3 text-sm">Ajustar o regenerar</button>
    </section>}
  </main>;
}
