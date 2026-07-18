"use client";

import { Box, CheckCircle2, ImagePlus, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function safeStem(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9áéíóúñ_-]+/gi, "-").replace(/^-+|-+$/g, "") || "objeto-clouva";
}

async function uploadReference(userId: string, side: "front" | "back", file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${userId}/object-multiview/${crypto.randomUUID()}-${side}.${extension}`;
  const uploaded = await supabase.storage.from("creator-reference-assets").upload(path, file, {
    contentType: file.type || "image/png",
    cacheControl: "3600",
    upsert: false,
  });
  if (uploaded.error) throw uploaded.error;
  const signed = await supabase.storage.from("creator-reference-assets").createSignedUrl(path, 60 * 60);
  if (signed.error || !signed.data.signedUrl) throw signed.error || new Error("No se pudo firmar la referencia");
  return { path, url: signed.data.signedUrl };
}

type ApiResponse = {
  taskId?: string;
  status?: string;
  progress?: number;
  glbUrl?: string;
  libraryUrl?: string;
  filename?: string;
  error?: string;
};

export function ObjectImageCreator() {
  const { user, session, loading } = useAuth();
  const [name, setName] = useState("Mi objeto CLOUVA");
  const [category, setCategory] = useState("accessory");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Subí una imagen de frente y otra de atrás del mismo objeto.");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function api(action: string, body: Record<string, unknown>) {
    if (!session?.access_token) throw new Error("Tu sesión venció. Volvé a iniciar sesión.");
    const response = await fetch("/api/creator-studio/object-from-images", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...body }),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    if (!response.ok) throw new Error(data.error || `Falló el creador de objetos (${response.status})`);
    return data;
  }

  async function createObject() {
    if (!user || !front || !back || running) return;
    setRunning(true);
    setProgress(2);
    setError(null);
    setResult(null);

    try {
      setMessage("Guardando referencias de frente y espalda…");
      const [frontRef, backRef] = await Promise.all([
        uploadReference(user.id, "front", front),
        uploadReference(user.id, "back", back),
      ]);

      setProgress(8);
      setMessage("Enviando las dos vistas a Meshy…");
      const created = await api("create", {
        name: safeStem(name),
        category,
        frontUrl: frontRef.url,
        backUrl: backRef.url,
        referencePaths: [frontRef.path, backRef.path],
      });
      if (!created.taskId) throw new Error("Meshy no devolvió el identificador de la tarea.");

      const startedAt = Date.now();
      while (Date.now() - startedAt < 35 * 60 * 1000) {
        const status = await api("status", { taskId: created.taskId });
        const nextProgress = Math.max(8, Math.min(96, Math.round(status.progress ?? 0)));
        setProgress(nextProgress);
        setMessage(`Meshy está construyendo el objeto 3D… ${nextProgress}%`);

        const state = String(status.status || "").toUpperCase();
        if (["FAILED", "CANCELED", "EXPIRED"].includes(state)) {
          throw new Error(status.error || "Meshy no pudo generar el objeto.");
        }
        if (state === "SUCCEEDED" && status.glbUrl) {
          setProgress(97);
          setMessage("Guardando el GLB en tu Biblioteca CLOUVA…");
          const finalized = await api("finalize", {
            taskId: created.taskId,
            name: safeStem(name),
            category,
            glbUrl: status.glbUrl,
            referencePaths: [frontRef.path, backRef.path],
          });
          setResult(finalized);
          setProgress(100);
          setMessage("Objeto listo. Ya podés exportarlo para Unreal desde Biblioteca.");
          return;
        }
        await sleep(5000);
      }
      throw new Error("La generación superó el tiempo máximo de espera.");
    } catch (cause) {
      setProgress(0);
      setMessage("Subí dos vistas claras del mismo objeto y volvé a intentar.");
      setError(cause instanceof Error ? cause.message : "No se pudo crear el objeto.");
    } finally {
      setRunning(false);
    }
  }

  if (loading || !user) return null;

  return (
    <section className="mx-auto mt-6 w-[min(1120px,calc(100%-32px))] overflow-hidden rounded-3xl border border-violet-400/20 bg-[#0d0918] p-5 text-white shadow-2xl sm:p-7">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-600"><Sparkles /></span>
        <div>
          <p className="text-[10px] font-black tracking-[0.18em] text-violet-300">CREADOR MULTIVISTA</p>
          <h2 className="mt-1 text-2xl font-black">Crear objeto para CLOUVA y Unreal</h2>
          <p className="mt-2 text-sm text-white/55">Frente + espalda → Meshy → GLB en Biblioteca → Blender → FBX para Unreal.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {([['front', 'Imagen de frente', front, setFront], ['back', 'Imagen de atrás', back, setBack]] as const).map(([id, label, file, setter]) => (
          <label key={id} className="group grid min-h-48 cursor-pointer place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 text-center hover:border-violet-400/50">
            <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setter(event.target.files?.[0] ?? null)} disabled={running} />
            {file ? (
              <div className="w-full">
                <img src={URL.createObjectURL(file)} alt={label} className="mx-auto h-36 max-w-full rounded-xl object-contain" />
                <strong className="mt-3 block text-sm">{label} ✓</strong>
                <small className="text-white/40">{file.name}</small>
              </div>
            ) : (
              <div><ImagePlus className="mx-auto h-9 w-9 text-violet-300" /><strong className="mt-3 block">{label}</strong><small className="mt-1 block text-white/40">Vista recta, fondo limpio y objeto completo</small></div>
            )}
          </label>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre del objeto" className="h-12 rounded-xl border border-white/10 bg-white/[0.04] px-4 outline-none focus:border-violet-400/50" disabled={running} />
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-12 rounded-xl border border-white/10 bg-[#151023] px-4 outline-none" disabled={running}>
          <option value="accessory">Accesorio</option><option value="hat">Gorra / sombrero</option><option value="necklace">Cadena</option><option value="glasses">Lentes</option><option value="shoes">Zapatillas</option><option value="prop">Objeto / prop</option>
        </select>
      </div>

      <button type="button" onClick={() => void createObject()} disabled={running || !front || !back || !session?.access_token} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-700 to-violet-500 font-black disabled:cursor-not-allowed disabled:opacity-45">
        {running ? <Loader2 className="animate-spin" /> : <Box />}
        {running ? "CREANDO OBJETO 3D…" : "GENERAR OBJETO CON MESHY"}
      </button>

      {(running || progress > 0) && !error ? <div className="mt-4"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-white/55">{message}</p></div> : null}
      {error ? <div className="mt-4 flex gap-2 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200"><TriangleAlert className="h-5 w-5 shrink-0" />{error}</div> : null}
      {result?.libraryUrl ? <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm"><CheckCircle2 className="text-emerald-300" /><strong>GLB guardado en Biblioteca</strong><a href={result.libraryUrl} target="_blank" rel="noreferrer" className="ml-auto font-bold text-violet-200 underline">Abrir GLB</a><a href="/biblioteca" className="font-bold text-violet-200 underline">Exportar para Unreal</a></div> : null}
    </section>
  );
}
