"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";

type RigStatus = {
  status?: string;
  progress?: number;
  task_error?: { message?: string };
  error?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function OfficialAvatarRigCard() {
  const { session } = useAuth();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("El avatar oficial necesita esqueleto para que las mangas y la ropa se deformen correctamente.");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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

  const start = async () => {
    setRunning(true);
    setError(null);
    setDone(false);
    setProgress(0);

    try {
      setMessage("Enviando el avatar oficial a Meshy…");
      const created = await call({ action: "create" });
      if (created.alreadyRigged) {
        setProgress(100);
        setDone(true);
        setMessage("El avatar oficial ya tiene rigging.");
        return;
      }

      const taskId = String(created.taskId ?? "");
      if (!taskId) throw new Error("Meshy no devolvió un taskId");

      const startedAt = Date.now();
      while (Date.now() - startedAt < 20 * 60 * 1000) {
        await sleep(5000);
        const status = (await call({ action: "status", taskId })) as RigStatus;
        const current = Math.max(0, Math.min(99, Math.round(status.progress ?? 0)));
        setProgress(current);
        setMessage(current >= 95 ? "Meshy está terminando el esqueleto…" : `Riggeando avatar oficial… ${current}%`);

        if (status.status === "FAILED" || status.status === "EXPIRED") {
          throw new Error(status.task_error?.message || "Meshy no pudo riggear el avatar");
        }
        if (status.status === "SUCCEEDED") break;
      }

      setMessage("Guardando el avatar riggeado como base oficial…");
      await call({ action: "finalize", taskId });
      setProgress(100);
      setDone(true);
      setMessage("Avatar oficial riggeado. Las prendas nuevas ya pueden copiar sus pesos correctamente.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado");
      setMessage("No se pudo completar el rigging.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-violet-300">Avatar Engine</p>
          <h2 className="mt-1 text-xl font-semibold">Rigging del avatar oficial</h2>
          <p className="mt-2 max-w-xl text-sm text-white/55">{message}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${done ? "bg-emerald-400/15 text-emerald-300" : running ? "bg-violet-400/15 text-violet-200" : "bg-white/10 text-white/50"}`}>
          {done ? "Listo" : running ? "Procesando" : "Pendiente"}
        </span>
      </div>

      {running || progress > 0 ? (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-white/45">
            <span>Progreso</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p> : null}

      <button
        type="button"
        onClick={start}
        disabled={running || done || !session?.access_token}
        className="mt-4 rounded-2xl bg-violet-400 px-5 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45"
      >
        {done ? "Avatar ya riggeado" : running ? "Riggeando…" : "Riggear avatar oficial"}
      </button>
    </section>
  );
}
