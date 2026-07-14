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

  const generateDesign = async () => {
    setError(null);
    try {
      if (!session?.access_token) throw new Error("Iniciá sesión.");
      if (!avatar.modelUrl) throw new Error("No hay un avatar GLB activo.");
      if (!description.trim()) throw new Error("Describí el diseño que querés crear.");
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
      if (!session?.access_token || !files.front || !files.back) throw new Error("Primero generá y aprobá las referencias.");
      setPhase("uploading");
      const form = new FormData();
      form.append("front", files.front); form.append("back", files.back);
      if (files.side) form.append("side", files.side);
      form.append("category", category); form.append("name", name || "Prenda CLOUVA");
      form.append("fit", fit); form.append("color", color); form.append("description", description);
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

  const upload = (side: Side, label: string) => <label className="block cursor-pointer rounded-2xl border border-dashed border-white/15 bg-black/25 p-2 text-center">
    {previews[side] ? <img src={previews[side]!} alt={label} className="aspect-square w-full rounded-xl object-contain" /> : <div className="grid aspect-square place-items-center text-xs text-white/45">{label}<br/>Subir manualmente</div>}
    <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => {
      const file = e.target.files?.[0] || null;
      setFiles((v) => ({ ...v, [side]: file }));
      setPreviews((v) => ({ ...v, [side]: file ? URL.createObjectURL(file) : null }));
      if (file) setPhase("review");
    }} />
  </label>;

  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 text-white">
    <div className="mb-5 flex justify-between"><Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link><span className="text-xs text-white/40">GARMENT FLOW</span></div>
    {!result ? <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <h1 className="text-2xl font-semibold">Crear sobre el molde del avatar</h1>
      <p className="mb-4 mt-1 text-sm text-white/45">GLB → medidas → referencias con IA → Meshy → calce en el visor.</p>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">{CATEGORIES.map(([value, label]) => <button key={value} onClick={() => setCategory(value)} className={`rounded-xl border px-2 py-2 text-xs ${category === value ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/60"}`}>{label}</button>)}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la prenda" className="mb-3 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm" />
      <div className="mb-3 flex items-center gap-3"><span className="text-xs text-white/50">Color</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></div>
      <div className="mb-3 flex flex-wrap gap-2">{FITS.map((item) => <button key={item} onClick={() => setFit(item)} className={`rounded-full border px-3 py-1.5 text-xs ${fit === item ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/60"}`}>{item}</button>)}</div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Ej: buzo negro oversized, trébol plateado adelante, diseño grande violeta atrás, mangas anchas y capucha profunda..." className="mb-4 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm" />
      <button onClick={generateDesign} disabled={busy} className="mb-4 w-full rounded-2xl bg-violet-400 py-3 font-semibold text-black disabled:opacity-50">{phase === "measuring" ? "Analizando medidas del GLB…" : phase === "designing" ? "Creando frente, espalda y lateral…" : previews.front ? "Regenerar diseño con IA" : "Crear referencias con IA"}</button>
      {measurements ? <p className="mb-3 rounded-xl bg-white/5 p-3 text-xs text-white/50">Molde: {measurements.slotWidth.toFixed(2)} × {measurements.slotHeight.toFixed(2)} × {measurements.slotDepth.toFixed(2)} m</p> : null}
      <div className="mb-4 grid grid-cols-3 gap-2">{upload("front", "Frente")}{upload("back", "Espalda")}{upload("side", "Lateral")}</div>
      {previews.front && previews.back ? <button onClick={generate3D} disabled={busy} className="w-full rounded-2xl bg-white py-3 font-semibold text-black disabled:opacity-50">{phase === "uploading" ? "Preparando Meshy…" : phase === "generating" ? `Moldeando objeto 3D… ${progress}%` : phase === "saving" ? "Guardando GLB…" : "Aprobar diseño y generar 3D"}</button> : null}
      {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
    </section> : <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <h1 className="mb-3 text-xl font-semibold">Objeto 3D listo ✓</h1>
      <div className="h-[430px] overflow-hidden rounded-2xl border border-white/10 bg-black/40"><OutfitPreview avatarUrl={avatar.modelUrl} layers={[{ id: result.id, url: result.modelUrl, visible: true, category }]} /></div>
      <button onClick={() => { setResult(null); setPhase("review"); }} className="mt-3 w-full rounded-2xl border border-white/15 py-3 text-sm">Ajustar o regenerar</button>
    </section>}
  </main>;
}
