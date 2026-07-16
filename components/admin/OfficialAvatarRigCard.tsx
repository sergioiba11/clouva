"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OfficialAvatarRigPreview, type RigValidation } from "@/components/admin/OfficialAvatarRigPreview";

type Job = { taskId: string; startedAt: number };
type Status = { status?: string; progress?: number; task_error?: { message?: string }; error?: string };

const KEY = "clouva:official-avatar-rig-job";
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const EMPTY_VALIDATION: RigValidation = { loading: false, valid: false, bones: 0, skinnedMeshes: 0, animations: 0, missing: [] };

export function OfficialAvatarRigCard() {
  const { session } = useAuth();
  const [state, setState] = useState<"checking" | "pending" | "running" | "success" | "failed">("checking");
  const [message, setMessage] = useState("Buscando el estado del rigging…");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [validation, setValidation] = useState<RigValidation>(EMPTY_VALIDATION);
  const busy = useRef(false);

  const request = async (url: string, body: Record<string, unknown>) => {
    if (!session?.access_token) throw new Error("Iniciá sesión como administrador");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    return data;
  };

  const call = (body: Record<string, unknown>) => request("/api/debug/rig-official", body);

  const fail = (text: string) => {
    localStorage.removeItem(KEY);
    setState("failed");
    setProgress(0);
    setError(text);
    setMessage("El avatar activo no tiene un rig humanoide válido.");
    setCheckedAt(Date.now());
    busy.current = false;
  };

  const success = (text: string, url?: string | null) => {
    localStorage.removeItem(KEY);
    setState("success");
    setProgress(100);
    setError(null);
    setMessage(text);
    if (url) setAvatarUrl(url);
    setCheckedAt(Date.now());
    busy.current = false;
  };

  const finalize = async (id: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        return await request("/api/debug/rig-official/finalize", { taskId: id });
      } catch (cause) {
        lastError = cause;
        if (!(cause instanceof Error) || !cause.message.includes("todavía no terminó")) throw cause;
        setCheckedAt(Date.now());
        setProgress(99);
        setMessage("Meshy terminó el rigging y CLOUVA está guardando el archivo 3D…");
        await sleep(5000);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Meshy no publicó el archivo riggeado a tiempo");
  };

  const follow = async (job: Job) => {
    busy.current = true;
    setState("running");
    setTaskId(job.taskId);
    setError(null);
    localStorage.setItem(KEY, JSON.stringify(job));
    try {
      while (Date.now() - job.startedAt < 30 * 60 * 1000) {
        const status = (await call({ action: "status", taskId: job.taskId })) as Status;
        setCheckedAt(Date.now());
        const value = Math.max(0, Math.min(99, Math.round(status.progress ?? 0)));
        setProgress(value);
        setMessage(value >= 95 ? "Meshy está terminando el esqueleto…" : `Riggeando avatar oficial… ${value}%`);
        if (status.status === "FAILED" || status.status === "EXPIRED" || status.status === "CANCELED") throw new Error(status.task_error?.message || status.error || "Meshy no pudo riggear el avatar");
        if (status.status === "SUCCEEDED") {
          setMessage("Guardando y validando el avatar riggeado…");
          const completed = await finalize(job.taskId);
          setAvatarUrl(completed.newAvatarUrl || null);
          setValidation({ ...EMPTY_VALIDATION, loading: true });
          success("Rigging terminado. Verificando huesos y skin weights…", completed.newAvatarUrl);
          return;
        }
        await sleep(5000);
      }
      throw new Error("El rigging superó el tiempo máximo de 30 minutos");
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "Error inesperado");
    }
  };

  const refresh = async () => {
    if (!session?.access_token || busy.current) return;
    busy.current = true;
    setState("checking");
    setError(null);
    try {
      const current = await call({ action: "current" });
      setCheckedAt(Date.now());
      setAvatarUrl(current.newAvatarUrl || null);
      if (current.alreadyRigged || current.status === "SUCCEEDED") {
        setMessage("El archivo existe. CLOUVA está comprobando que tenga huesos reales…");
        setState("checking");
        busy.current = false;
        return;
      }
      if (current.status === "FAILED" || current.status === "EXPIRED" || current.status === "CANCELED") return fail(String(current.failureMessage || current.error || "Meshy no pudo riggear el avatar"));
      if (current.active && current.taskId) return void follow({ taskId: String(current.taskId), startedAt: Number(current.startedAt || Date.now()) });
      const raw = localStorage.getItem(KEY);
      if (raw) return void follow(JSON.parse(raw) as Job);
      setState("pending");
      setMessage("Todavía no hay un rigging completado ni un proceso activo.");
      busy.current = false;
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "No se pudo consultar el estado");
    }
  };

  useEffect(() => { void refresh(); }, [session?.access_token]);

  const handleValidation = useCallback((next: RigValidation) => {
    setValidation(next);
    if (next.loading) {
      setState("checking");
      setMessage("Analizando esqueleto, skin weights y huesos humanoides…");
      return;
    }
    if (next.error) {
      fail(`No se pudo validar el GLB: ${next.error}`);
      return;
    }
    if (next.valid) {
      success(`Rig válido: ${next.bones} huesos y ${next.skinnedMeshes} malla(s) con skin weights.`);
      return;
    }
    const missing = next.missing.length ? ` Faltan: ${next.missing.join(", ")}.` : "";
    fail(`Se detectaron ${next.bones} huesos y ${next.skinnedMeshes} mallas riggeadas.${missing}`);
  }, []);

  const start = async () => {
    busy.current = true;
    setState("running");
    setProgress(0);
    setError(null);
    setTaskId(null);
    setMessage(validation.valid ? "Creando un nuevo proceso de rigging…" : "Reprocesando el avatar porque el rig actual no es válido…");
    try {
      localStorage.removeItem(KEY);
      const created = await call({ action: "create", force: !validation.valid });
      if (created.alreadyRigged && validation.valid) return success("El avatar oficial ya tiene un rig validado.", created.newAvatarUrl);
      const id = String(created.taskId || "");
      if (!id) throw new Error("Meshy no devolvió un taskId");
      await follow({ taskId: id, startedAt: Number(created.startedAt || Date.now()) });
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "Error inesperado");
    }
  };

  const label = validation.loading || state === "checking" ? "Verificando" : validation.valid ? "Rig válido" : state === "running" ? "Procesando" : state === "failed" ? "Sin rig" : "Pendiente";
  const disabled = state === "running" || state === "checking" || !session?.access_token;

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5" data-ui-version="rig-validation-preview-v1">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-violet-300">Avatar Engine</p>
          <h2 className="mt-1 text-xl font-semibold">Rigging del avatar oficial</h2>
          <p className="mt-2 text-sm text-white/55">{message}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs">{label}</span>
      </div>

      <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <div>Estado<br/><strong>{label}</strong></div>
        <div>Huesos<br/><strong>{validation.loading ? "…" : validation.bones}</strong></div>
        <div>Skinned meshes<br/><strong>{validation.loading ? "…" : validation.skinnedMeshes}</strong></div>
        <div>Animaciones<br/><strong>{validation.loading ? "…" : validation.animations}</strong></div>
        <div>Última consulta<br/><strong>{checkedAt ? new Date(checkedAt).toLocaleString("es-AR") : "—"}</strong></div>
        <div>Proceso Meshy<br/><strong>{taskId ? taskId.slice(0, 12) : "—"}</strong></div>
      </div>

      {(state === "running" || progress > 0) && <div className="mt-4"><div className="mb-1 flex justify-between text-xs"><span>Progreso real de Meshy</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-violet-400" style={{ width: `${Math.max(progress, 3)}%` }} /></div></div>}
      {validation.valid && <p className="mt-3 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-300">✓ El GLB contiene un esqueleto humanoide y skin weights verificables.</p>}
      {error && <p className="mt-3 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-300">✕ {error}</p>}

      {avatarUrl && <OfficialAvatarRigPreview url={avatarUrl} onValidation={handleValidation} />}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={start} disabled={disabled || validation.valid} className="rounded-2xl bg-violet-400 px-5 py-3 text-sm font-semibold text-black disabled:opacity-45">
          {state === "running" ? "Riggeando…" : validation.valid ? "Rig validado" : "Regenerar rig real"}
        </button>
        <button type="button" onClick={() => void refresh()} disabled={state === "running" || state === "checking"} className="rounded-2xl border border-white/10 px-4 py-3 text-sm">Actualizar y validar</button>
      </div>
    </section>
  );
}
