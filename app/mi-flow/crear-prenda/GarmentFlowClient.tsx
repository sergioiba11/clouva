"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { OutfitPreview } from "@/components/avatar-engine/OutfitPreview";

const CATEGORIES = [
  ["hoodie", "Buzo"], ["shirt", "Remera"], ["jacket", "Campera"],
  ["pants", "Pantalón baggy"], ["shorts", "Short"], ["shoes", "Zapatillas"], ["accessory", "Accesorio"],
] as const;

const FITS = ["Entallado", "Normal", "Oversized", "Baggy"];
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_STATUS_ERRORS = 5;

type Phase = "idle" | "creating" | "preview" | "refining" | "rigging" | "done" | "error";

type MeshyStatus = {
  status?: string;
  progress?: number;
  model_urls?: { glb?: string };
  task_error?: { message?: string };
  error?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function GarmentFlowClient() {
  const { session } = useAuth();
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const [category, setCategory] = useState("hoodie");
  const [name, setName] = useState("");
  const [fit, setFit] = useState("Oversized");
  const [color, setColor] = useState("#0a0a0a");
  const [description, setDescription] = useState("");
  const [art, setArt] = useState<File | null>(null);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; modelUrl: string } | null>(null);

  const busy = ["creating", "preview", "refining", "rigging"].includes(phase);

  const poll = async (taskId: string): Promise<MeshyStatus> => {
    const startedAt = Date.now();
    let consecutiveErrors = 0;

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);

      try {
        const response = await fetch(`/api/meshy/status?taskId=${encodeURIComponent(taskId)}&t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as MeshyStatus;

        if (!response.ok || data.error) {
          throw new Error(data.error || `Meshy respondió ${response.status}`);
        }

        consecutiveErrors = 0;
        const status = String(data.status ?? "").toUpperCase();
        const reported = typeof data.progress === "number" ? Math.round(data.progress) : 0;
        setProgress(status === "SUCCEEDED" ? 100 : Math.max(0, Math.min(99, reported)));

        if (status === "SUCCEEDED") return { ...data, status };
        if (status === "FAILED" || status === "EXPIRED") {
          return { ...data, status };
        }
      } catch (statusError) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_STATUS_ERRORS) throw statusError;
      }
    }

    throw new Error("Meshy tardó más de 15 minutos. La tarea puede seguir activa; revisá Mis piezas en unos minutos.");
  };

  const generate3D = async () => {
    setError(null);
    setProgress(0);

    try {
      if (!session?.access_token) throw new Error("Iniciá sesión.");
      if (!avatar.modelUrl) throw new Error("No hay un avatar activo.");
      if (!description.trim()) throw new Error("Describí cómo querés la prenda.");

      setPhase("creating");
      const form = new FormData();
      form.append("category", category);
      form.append("name", name || "Prenda CLOUVA");
      form.append("fit", fit);
      form.append("color", color);
      form.append("description", description.trim());
      if (art) form.append("art", art);

      const createResponse = await fetch("/api/clothing/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error) throw new Error(created.error || "No se pudo iniciar Meshy.");

      setPhase("preview");
      const preview = await poll(created.taskId);
      if (preview.status !== "SUCCEEDED") {
        throw new Error(preview.task_error?.message || "Meshy no pudo crear la forma inicial.");
      }

      setPhase("refining");
      setProgress(0);
      const refineResponse = await fetch("/api/clothing/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ previewTaskId: created.taskId, itemId: created.item.id }),
      });
      const refinedTask = await refineResponse.json();
      if (!refineResponse.ok || refinedTask.error) throw new Error(refinedTask.error || "No se pudo refinar la prenda.");

      const refined = await poll(refinedTask.taskId);
      if (refined.status !== "SUCCEEDED" || !refined.model_urls?.glb) {
        throw new Error(refined.task_error?.message || "Meshy no pudo terminar la prenda.");
      }

      setPhase("rigging");
      setProgress(100);
      const saveResponse = await fetch("/api/clothing/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ itemId: created.item.id, modelUrl: refined.model_urls.glb }),
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok || saved.error || !saved.item?.model_url) {
        throw new Error(saved.error || "No se pudo guardar y riggear la prenda.");
      }

      setResult({ id: saved.item.id, modelUrl: saved.item.model_url });
      setPhase("done");
      setProgress(100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado");
      setPhase("error");
    }
  };

  const phaseLabel =
    phase === "creating" ? "Enviando diseño a Meshy…" :
    phase === "preview" && progress >= 99 ? "Meshy está cerrando la forma…" :
    phase === "preview" ? `Creando forma 3D… ${progress}%` :
    phase === "refining" && progress >= 99 ? "Meshy está terminando materiales…" :
    phase === "refining" ? `Agregando detalles y materiales… ${progress}%` :
    phase === "rigging" ? "Adaptando, texturizando y riggeando…" :
    "Generar prenda 3D";

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 text-white">
      <div className="mb-5 flex justify-between">
        <Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link>
        <span className="text-xs text-white/40">GARMENT FLOW</span>
      </div>

      {!result ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h1 className="text-2xl font-semibold">Crear una prenda para tu avatar</h1>
          <p className="mb-4 mt-1 text-sm text-white/45">
            Elegís la pieza y el estilo. Meshy crea el objeto 3D y CLOUVA lo adapta al cuerpo.
          </p>

          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {CATEGORIES.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setCategory(value)} className={`rounded-xl border px-2 py-2 text-xs ${category === value ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/60"}`}>
                {label}
              </button>
            ))}
          </div>

          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la prenda" className="mb-3 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm" />

          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs text-white/50">Color principal</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {FITS.map((item) => (
              <button key={item} type="button" onClick={() => setFit(item)} className={`rounded-full border px-3 py-1.5 text-xs ${fit === item ? "border-violet-400 bg-violet-400/15" : "border-white/10 text-white/60"}`}>
                {item}
              </button>
            ))}
          </div>

          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Ej: buzo negro oversized, mangas anchas, capucha profunda, costuras violetas y estética futurista…" className="mb-4 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm" />

          <div className="mb-4 rounded-2xl border border-dashed border-white/15 bg-black/20 p-4">
            <p className="text-sm font-medium">Arte o logo opcional</p>
            <p className="mb-3 mt-1 text-xs text-white/45">Subilo únicamente como arte para la textura. No define la forma de la prenda.</p>
            <label className="block cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center text-sm text-white/60">
              {artPreview ? <img src={artPreview} alt="Arte para la prenda" className="mx-auto max-h-48 rounded-lg object-contain" /> : "Subir logo, portada o diseño"}
              <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setArt(file);
                setArtPreview(file ? URL.createObjectURL(file) : null);
              }} />
            </label>
            {art ? <button type="button" onClick={() => { setArt(null); setArtPreview(null); }} className="mt-2 text-xs text-white/45 underline">Quitar arte</button> : null}
          </div>

          <button type="button" onClick={generate3D} disabled={busy} className="w-full rounded-2xl bg-violet-400 py-3 font-semibold text-black disabled:opacity-50">
            {phaseLabel}
          </button>

          {busy ? (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full bg-violet-400 transition-all ${progress >= 99 ? "animate-pulse" : ""}`} style={{ width: `${Math.max(6, progress)}%` }} />
              </div>
              {progress >= 99 ? <p className="mt-2 text-center text-xs text-white/45">El 99% puede tardar unos minutos mientras Meshy empaqueta el modelo.</p> : null}
            </>
          ) : null}

          {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
        </section>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h1 className="mb-3 text-xl font-semibold">Prenda 3D lista ✓</h1>
          <div className="h-[430px] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
            <OutfitPreview avatarUrl={avatar.modelUrl} layers={[{ id: result.id, url: result.modelUrl, visible: true, category }]} />
          </div>
          <Link href="/mi-flow/armario" className="mt-3 block w-full rounded-2xl bg-violet-400 py-3 text-center text-sm font-semibold text-black">Ver en mis piezas</Link>
          <button type="button" onClick={() => { setResult(null); setPhase("idle"); setProgress(0); }} className="mt-2 w-full rounded-2xl border border-white/15 py-3 text-sm">Crear otra pieza</button>
        </section>
      )}
    </main>
  );
}
