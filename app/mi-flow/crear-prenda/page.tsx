"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { OutfitPreview } from "@/components/avatar-engine/OutfitPreview";

const CATEGORIES = [
  { value: "hoodie", label: "Buzo" },
  { value: "shirt", label: "Remera" },
  { value: "jacket", label: "Campera" },
  { value: "pants", label: "Pantalón baggy" },
  { value: "shorts", label: "Short" },
  { value: "shoes", label: "Zapatillas" },
  { value: "accessory", label: "Accesorio" },
];
const FITS = ["Entallado", "Normal", "Oversized", "Baggy"];

type Phase = "idle" | "uploading" | "generating" | "saving" | "done" | "error";
type Side = "front" | "back" | "side";

export default function CrearPrendaPage() {
  const { session } = useAuth();
  const activeAvatar = useActiveAvatarStore((state) => state.avatar);

  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [name, setName] = useState("");
  const [fit, setFit] = useState(FITS[1]);
  const [color, setColor] = useState("#0a0a0a");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<Record<Side, File | null>>({ front: null, back: null, side: null });
  const [previews, setPreviews] = useState<Record<Side, string | null>>({ front: null, back: null, side: null });
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; modelUrl: string; category: string } | null>(null);
  const [showOnAvatar, setShowOnAvatar] = useState(true);

  const busy = phase === "uploading" || phase === "generating" || phase === "saving";

  const chooseFile = (side: Side, file: File | null) => {
    setFiles((f) => ({ ...f, [side]: file }));
    setPreviews((p) => ({ ...p, [side]: file ? URL.createObjectURL(file) : null }));
  };

  const pollTask = async (taskId: string) => {
    while (true) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch(`/api/meshy/status?taskId=${taskId}&kind=multi-image`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (typeof data.progress === "number") setProgress(data.progress);
      if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(data.status)) return data;
    }
  };

  const generate = async () => {
    setErrorMsg(null);
    setResult(null);
    setProgress(0);
    try {
      if (!session?.access_token) throw new Error("Iniciá sesión.");
      if (!files.front || !files.back) throw new Error("Subí al menos frente y espalda de la prenda.");

      setPhase("uploading");
      const form = new FormData();
      form.append("front", files.front);
      form.append("back", files.back);
      if (files.side) form.append("side", files.side);
      form.append("category", category);
      form.append("name", name);
      form.append("fit", fit);
      form.append("color", color);
      form.append("description", description);

      const createRes = await fetch("/api/clothing/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const created = await createRes.json();
      if (!createRes.ok || created.error) throw new Error(created.error || "No se pudo iniciar la generación.");

      setPhase("generating");
      const generated = await pollTask(created.taskId);
      if (generated.status !== "SUCCEEDED" || !generated.model_urls?.glb) {
        throw new Error(generated.task_error?.message || "No se pudo generar la prenda.");
      }

      setPhase("saving");
      const finalizeRes = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ itemId: created.item.id, modelUrl: generated.model_urls.glb }),
      });
      const saved = await finalizeRes.json();
      if (!finalizeRes.ok || saved.error || !saved.item?.model_url) throw new Error(saved.error || "No se pudo guardar la prenda.");

      setResult({ id: saved.item.id, modelUrl: saved.item.model_url, category });
      setPhase("done");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Error inesperado.");
      setPhase("error");
    }
  };

  const uploadBox = (side: Side, label: string) => (
    <label className="block cursor-pointer overflow-hidden rounded-2xl border border-dashed border-white/15 bg-black/25 p-3 text-center">
      {previews[side] ? (
        <img src={previews[side]!} alt={label} className="mx-auto aspect-square w-full rounded-xl object-contain" />
      ) : (
        <div className="grid aspect-square place-items-center">
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="mt-1 text-xs text-white/40">Subir foto</p>
          </div>
        </div>
      )}
      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy} onChange={(e) => chooseFile(side, e.target.files?.[0] ?? null)} />
    </label>
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 text-white">
      <div className="mb-5 flex items-center justify-between">
        <Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link>
        <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">Crear prenda</span>
      </div>

      {!result ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300/80">Nueva prenda 3D</p>
          <h1 className="mb-4 text-2xl font-semibold">¿Qué querés crear?</h1>

          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                disabled={busy}
                className={`rounded-xl border px-2 py-2 text-xs ${category === c.value ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/60"}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la prenda"
            disabled={busy}
            className="mb-3 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm"
          />

          <div className="mb-4 grid grid-cols-3 gap-2">
            {uploadBox("front", "Frente")}
            {uploadBox("back", "Espalda")}
            {uploadBox("side", "Lateral (opcional)")}
          </div>

          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs text-white/50">Color base</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={busy} className="h-8 w-8 rounded-full border border-white/20 bg-transparent" />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {FITS.map((f) => (
              <button
                key={f}
                onClick={() => setFit(f)}
                disabled={busy}
                className={`rounded-full border px-3 py-1.5 text-xs ${fit === f ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/60"}`}
              >
                {f}
              </button>
            ))}
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Describí detalles (logo, estampado, textura, etc.) — opcional"
            className="mb-4 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm placeholder:text-white/30"
          />

          <button onClick={generate} disabled={busy} className="w-full rounded-2xl bg-violet-400 py-3.5 text-sm font-semibold text-black disabled:opacity-50">
            {phase === "idle" && "Generar prenda"}
            {phase === "uploading" && "Subiendo referencias…"}
            {phase === "generating" && `Generando modelo 3D… ${progress}%`}
            {phase === "saving" && "Guardando…"}
            {phase === "error" && "Reintentar"}
          </button>

          {errorMsg ? <p className="mt-3 text-sm text-rose-400">{errorMsg}</p> : null}
        </section>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h1 className="mb-3 text-xl font-semibold">Prenda lista ✓</h1>
          <div className="mb-4 h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
            <OutfitPreview
              avatarUrl={activeAvatar.modelUrl}
              layers={showOnAvatar ? [{ id: result.id, url: result.modelUrl, visible: true, category: result.category }] : []}
            />
          </div>
          <button
            onClick={() => setShowOnAvatar((v) => !v)}
            className="mb-3 w-full rounded-2xl border border-white/15 py-3 text-sm"
          >
            {showOnAvatar ? "Quitar del avatar" : "Probar en mi avatar"}
          </button>
          <div className="flex gap-2">
            <button onClick={() => setResult(null)} className="flex-1 rounded-2xl border border-white/10 py-2.5 text-sm text-white/60">
              Crear otra
            </button>
            <Link href="/mi-flow/avatar" className="flex-1 rounded-2xl bg-violet-400 py-2.5 text-center text-sm font-medium text-black">
              Ir al avatar
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
