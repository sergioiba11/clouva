"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type RigStatus = {
  status?: string;
  progress?: number;
  task_error?: { message?: string };
  error?: string;
};

type StoredRigJob = {
  taskId: string;
  startedAt: number;
};

const STORAGE_KEY = "clouva:official-avatar-rig-job";
const UI_VERSION = "rig-progress-v4-visible-result";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readStoredJob(): StoredRigJob | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRigJob;
    if (!parsed?.taskId || !parsed?.startedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredJob(job: StoredRigJob) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
}

function clearStoredJob() {
  window.localStorage.removeItem(STORAGE_KEY);
}

function formatTime(value: number | null) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return null;
  }
}

export function OfficialAvatarRigCard() {
  const { session } = useAuth();
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(true);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Buscando el estado del rigging…");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [lastStatus, setLastStatus] = useState<"pending" | "running" | "success" | "failed">("pending");
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const resumingRef = useRef(false);

  const call = async (body: Record<string, unknown>) => {
    if (!session?.access_token) throw new Error("Iniciá sesión como administrador");
    const response = await fetch("/api/debug/rig-official", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `Error ${response.status}`);
    return data;
  };

  const markSuccess = (text: string) => {
    clearStoredJob();
    setProgress(100);
    setDone(true);
    setRunning(false);
    setError(null);
    setLastStatus("success");
    setLastCheckedAt(Date.now());
    setMessage(text);
  };

  const markFailure = (text: string) => {
    clearStoredJob();
    setRunning(false);
    setDone(false);
    setError(text);
    setLastStatus("failed");
    setLastCheckedAt(Date.now());
    setMessage("El último intento de rigging falló.");
  };

  const followJob = async (job: StoredRigJob) => {
    setRunning(true);
    setChecking(false);
    setError(null);
    setDone(false);
    setTaskId(job.taskId);
    setLastStatus("running");
    setMessage("Reconectando con el proceso de Meshy…");

    try {
      while (Date.now() - job.startedAt < 20 * 60 * 1000) {
        const status = (await call({ action: "status", taskId: job.taskId })) as RigStatus;
        setLastCheckedAt(Date.now());
        const current = Math.max(0, Math.min(99, Math.round(status.progress ?? 0)));
        setProgress(current);
        setMessage(current >= 95 ? "Meshy está terminando el esqueleto…" : `Riggeando avatar oficial… ${current}%`);

        if (status.status === "FAILED" || status.status === "EXPIRED") {
          throw new Error(status.task_error?.message || status.error || "Meshy no pudo riggear el avatar");
        }

        if (status.status === "SUCCEEDED") {
          setMessage("Guardando el avatar riggeado como base oficial…");
          await call({ action: "finalize", taskId: job.taskId });
          markSuccess("Rigging completado. El avatar oficial ya tiene esqueleto y quedó guardado correctamente.");
          return;
        }

        await sleep(5000);
      }

      throw new Error("El rigging superó el tiempo máximo de 20 minutos");
    } catch (cause) {
      markFailure(cause instanceof Error ? cause.message : "Error inesperado");
    } finally {
      setRunning(false);
      resumingRef.current = false;
    }
  };

  const refreshStatus = async () => {
    if (!session?.access_token || resumingRef.current) return;
    resumingRef.current = true;

    try {
      setChecking(true);
      setError(null);
      setMessage("Buscando el estado del rigging…");
      const current = await call({ action: "current" });
      setLastCheckedAt(Date.now());

      if (current.alreadyRigged || current.status === "SUCCEEDED") {
        markSuccess("Rigging completado. El avatar oficial ya tiene esqueleto y está guardado como modelo activo.");
        resumingRef.current = false;
        return;
      }

      if (current.status === "FAILED" || current.status === "EXPIRED") {
        setTaskId(current.taskId ? String(current.taskId) : null);
        markFailure(String(current.error || "Meshy no pudo riggear el avatar"));
        resumingRef.current = false;
        return;
      }

      if (current.active && current.taskId) {
        const job = {
          taskId: String(current.taskId),
          startedAt: Number(current.startedAt || Date.now()),
        };
        saveStoredJob(job);
        setTaskId(job.taskId);
        const task = current.task as RigStatus | undefined;
        if (task?.status === "SUCCEEDED") {
          setRunning(true);
          setProgress(99);
          setLastStatus("running");
          setMessage("Rigging terminado. Guardando el avatar oficial…");
          await call({ action: "finalize", taskId: job.taskId });
          markSuccess("Rigging completado. El avatar oficial ya tiene esqueleto y quedó guardado correctamente.");
          resumingRef.current = false;
          return;
        }
        await followJob(job);
        return;
      }

      const localJob = readStoredJob();
      if (localJob) {
        await followJob(localJob);
        return;
      }

      setProgress(0);
      setDone(false);
      setLastStatus("pending");
      setMessage("Todavía no hay un rigging completado ni un proceso activo.");
    } catch (cause) {
      markFailure(cause instanceof Error ? cause.message : "No se pudo consultar el estado");
    } finally {
      setChecking(false);
      if (!running) resumingRef.current = false;
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, [session?.access_token]);

  const start = async () => {
    setRunning(true);
    setChecking(false);
    setError(null);
    setDone(false);
    setProgress(0);
    setLastStatus("running");
    setTaskId(null);

    try {
      setMessage("Enviando el avatar oficial a Meshy…");
      const created = await call({ action: "create" });
      if (created.alreadyRigged) {
        markSuccess("El avatar oficial ya estaba riggeado y sigue guardado correctamente.");
        return;
      }

      const createdTaskId = String(created.taskId ?? "");
      if (!createdTaskId) throw new Error("Meshy no devolvió un taskId");

      const job = { taskId: createdTaskId, startedAt: Number(created.startedAt || Date.now()) };
      setTaskId(createdTaskId);
      saveStoredJob(job);
      resumingRef.current = true;
      await followJob(job);
    } catch (cause) {
      markFailure(cause instanceof Error ? cause.message : "Error inesperado");
      resumingRef.current = false;
    }
  };

  const badge = done ? "Listo" : running ? "Procesando" : checking ? "Consultando" : lastStatus === "failed" ? "Falló" : "Pendiente";
  const badgeClass = done
    ? "bg-emerald-400/15 text-emerald-300"
    : lastStatus === "failed"
      ? "bg-rose-400/15 text-rose-300"
      : running || checking
        ? "bg-violet-400/15 text-violet-200"
        : "bg-white/10 text-white/50";

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5" data-ui-version={UI_VERSION}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-violet-300">Avatar Engine</p>
          <h2 className="mt-1 text-xl font-semibold">Rigging del avatar oficial</h2>
          <p className="mt-2 max-w-xl text-sm text-white/55">{message}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${badgeClass}`}>{badge}</span>
      </div>

      <div className="mt-4 grid gap-2 rounded-2xl border border-white/8 bg-black/20 p-3 text-xs text-white/50 sm:grid-cols-3">
        <div><span className="block text-white/30">Resultado</span><strong className="text-white/75">{badge}</strong></div>
        <div><span className="block text-white/30">Última consulta</span><strong className="text-white/75">{formatTime(lastCheckedAt) || "—"}</strong></div>
        <div><span className="block text-white/30">Proceso Meshy</span><strong className="break-all text-white/75">{taskId ? taskId.slice(0, 12) : "—"}</strong></div>
      </div>

      {running || progress > 0 ? (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-white/45">
            <span>Progreso real de Meshy</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
          {running ? <p className="mt-2 text-xs text-white/35">Podés recargar o salir. El estado se guarda en tu cuenta y reaparece al volver.</p> : null}
        </div>
      ) : null}

      {done ? <p className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">✓ El rigging terminó y el modelo riggeado está activo.</p> : null}
      {error ? <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">✕ {error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={start}
          disabled={running || checking || done || !session?.access_token}
          className="rounded-2xl bg-violet-400 px-5 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45"
        >
          {done ? "Avatar ya riggeado" : running ? "Riggeando…" : checking ? "Consultando estado…" : error ? "Reintentar rigging" : "Riggear avatar oficial"}
        </button>
        <button
          type="button"
          onClick={() => void refreshStatus()}
          disabled={running || checking || !session?.access_token}
          className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Actualizar estado
        </button>
      </div>
    </section>
  );
}
