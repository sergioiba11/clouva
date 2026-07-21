"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AvatarLibrary } from "@/components/avatar-engine/AvatarLibrary";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

type Phase = "idle" | "uploading" | "generating" | "saving" | "rigging" | "done" | "error";
type Side = "front" | "back";

type TaskResult = {
  status: string;
  progress?: number;
  model_urls?: { glb?: string };
  task_error?: { message?: string };
};

type SavedAvatar = {
  id: string;
  model_url: string;
  front_rotation_y?: number | null;
  updated_at?: string | null;
};

type RigApiResponse = {
  taskId?: string;
  status?: string;
  progress?: number;
  newAvatarUrl?: string;
  sourceAvatarId?: string | null;
  rigProfile?: { complete?: boolean };
  task?: { status?: string; progress?: number; task_error?: { message?: string } };
  task_error?: { message?: string };
  error?: string;
  stage?: string;
};

const TERMINAL_RIG_FAILURES = new Set(["FAILED", "EXPIRED", "CANCELED"]);
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function AvatarIaPage() {
  const { user, session } = useAuth();
  const setActiveAvatar = useActiveAvatarStore((state) => state.setActiveAvatar);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [savedAvatar, setSavedAvatar] = useState<SavedAvatar | null>(null);

  const busy = phase === "uploading"
    || phase === "generating"
    || phase === "saving"
    || phase === "rigging";

  const pollTask = async (taskId: string): Promise<TaskResult> => {
    while (true) {
      await sleep(4000);
      const response = await fetch(`/api/meshy/status?taskId=${taskId}&kind=multi-image`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (typeof data.progress === "number") setProgress(data.progress);
      if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(data.status)) return data;
    }
  };

  const requestRig = async (body: Record<string, unknown>) => {
    if (!session?.access_token) throw new Error("Tu sesión venció. Volvé a iniciar sesión.");
    const response = await fetch("/api/avatar/rig", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as RigApiResponse;
    if (!response.ok) {
      const detail = data.error || `No se pudo procesar el rig (${response.status}).`;
      throw new Error(data.stage ? `${data.stage}: ${detail}` : detail);
    }
    return data;
  };

  const completeRigAndActivate = async (avatar: SavedAvatar) => {
    setPhase("rigging");
    setProgress(0);
    setErrorMsg(null);
    setResultUrl(null);

    try {
      const created = await requestRig({ action: "create", force: true, source: "original-clean-glb" });
      const taskId = String(created.taskId ?? "");
      if (!taskId) throw new Error("El rigeador no devolvió un identificador de trabajo.");

      const startedAt = Date.now();
      while (Date.now() - startedAt < 30 * 60 * 1000) {
        const status = await requestRig({ action: "status", taskId });
        const remoteStatus = String(status.status ?? status.task?.status ?? "").toUpperCase();
        const nextProgress = Math.max(0, Math.min(99, Math.round(status.progress ?? status.task?.progress ?? 0)));
        setProgress(nextProgress);

        if (TERMINAL_RIG_FAILURES.has(remoteStatus)) {
          throw new Error(
            status.task_error?.message
            || status.task?.task_error?.message
            || status.error
            || "El rigeador no pudo completar el avatar.",
          );
        }

        if (remoteStatus === "SUCCEEDED") {
          const finalized = await requestRig({ action: "finalize", taskId });
          if (!finalized.newAvatarUrl || finalized.rigProfile?.complete !== true) {
            throw new Error(finalized.error || "El avatar no superó la validación completa.");
          }

          const finalAvatar: SavedAvatar = {
            ...avatar,
            id: finalized.sourceAvatarId || avatar.id,
            model_url: finalized.newAvatarUrl,
            updated_at: new Date().toISOString(),
          };
          setSavedAvatar(finalAvatar);
          setResultUrl(finalAvatar.model_url);
          setActiveAvatar({
            id: finalAvatar.id,
            source: "generated",
            modelUrl: finalAvatar.model_url,
            fallbackUrl: null,
            status: "ready",
            frontRotationY: Number(finalAvatar.front_rotation_y ?? 0),
            updatedAt: finalAvatar.updated_at ?? new Date().toISOString(),
          });
          setProgress(100);
          setPhase("done");
          return;
        }

        await sleep(5000);
      }

      throw new Error("El rig del avatar superó el tiempo máximo de 30 minutos.");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "No se pudo crear el rig completo.");
      setPhase("error");
    }
  };

  const chooseReference = (side: Side, file: File | null) => {
    setResultUrl(null);
    setSavedAvatar(null);
    setErrorMsg(null);
    setPhase("idle");

    if (side === "front") {
      if (frontPreview) URL.revokeObjectURL(frontPreview);
      setFront(file);
      setFrontPreview(file ? URL.createObjectURL(file) : null);
    } else {
      if (backPreview) URL.revokeObjectURL(backPreview);
      setBack(file);
      setBackPreview(file ? URL.createObjectURL(file) : null);
    }
  };

  const generate = async () => {
    setErrorMsg(null);
    setResultUrl(null);
    setSavedAvatar(null);
    setProgress(0);

    try {
      if (!user || !session?.access_token) throw new Error("Iniciá sesión para guardar el avatar.");
      if (!front || !back) throw new Error("Subí una imagen de frente y otra de espalda.");

      setPhase("uploading");
      const form = new FormData();
      form.append("front", front);
      form.append("back", back);
      if (prompt.trim()) form.append("prompt", prompt.trim());

      const createResponse = await fetch("/api/avatar/from-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error || !created.taskId) {
        throw new Error(created.error || "No se pudieron enviar las referencias.");
      }

      setPhase("generating");
      const generated = await pollTask(created.taskId);
      if (generated.status !== "SUCCEEDED" || !generated.model_urls?.glb) {
        throw new Error(generated.task_error?.message || "No se pudo crear el modelo 3D.");
      }

      setPhase("saving");
      const saveResponse = await fetch("/api/avatar/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          modelUrl: generated.model_urls.glb,
          meshyTaskId: created.taskId,
          name: "Avatar oficial CLOUVA",
        }),
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok || saved.error || !saved.avatar?.model_url) {
        throw new Error(saved.error || "No se pudo guardar el avatar.");
      }

      const avatar = saved.avatar as SavedAvatar;
      setSavedAvatar(avatar);
      await completeRigAndActivate(avatar);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Ocurrió un error inesperado.");
      setPhase("error");
    }
  };

  const primaryAction = () => {
    if (phase === "error" && savedAvatar) {
      void completeRigAndActivate(savedAvatar);
      return;
    }
    void generate();
  };

  const label = {
    idle: "Crear personaje 3D",
    uploading: "Subiendo frente y espalda…",
    generating: `Creando modelo 3D… ${progress}%`,
    saving: "Guardando original limpio…",
    rigging: progress >= 95 ? "Agregando dedos y orejas…" : `Creando rig completo… ${progress}%`,
    done: "Crear otra versión",
    error: savedAvatar ? "Reintentar rig" : "Volver a intentar",
  }[phase];

  const uploadCard = (side: Side, title: string, preview: string | null) => (
    <label className="block cursor-pointer overflow-hidden rounded-3xl border border-dashed border-violet-300/35 bg-black/25 p-4 text-center">
      {preview ? (
        <img src={preview} alt={`Referencia ${title}`} className="mx-auto aspect-[3/4] w-full rounded-2xl object-contain" />
      ) : (
        <div className="flex aspect-[3/4] items-center justify-center">
          <div>
            <p className="text-lg font-medium text-white">{title}</p>
            <p className="mt-2 text-sm text-white/45">Subir imagen</p>
          </div>
        </div>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={busy}
        onChange={(event) => chooseReference(side, event.target.files?.[0] ?? null)}
      />
    </label>
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-24 pt-5 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/mi-flow/avatar" className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/75">
          ← Volver
        </Link>
        <Link href="/mi-flow/crear-prenda" className="rounded-full border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-sm text-violet-200">
          Crear prenda →
        </Link>
      </div>

      <section className="rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(126,87,255,0.24),transparent_48%),rgba(6,6,12,0.9)] p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300/80">Frente + espalda</p>
        <h1 className="mt-3 text-3xl font-semibold text-white sm:text-5xl">Creá el personaje con dos vistas</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
          Subí una imagen del frente y otra de la espalda. CLOUVA crea el GLB original y después genera automáticamente el rig completo con dedos y orejas.
        </p>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:gap-5">
          {uploadCard("front", "Frente", frontPreview)}
          {uploadCard("back", "Espalda", backPreview)}
        </div>

        <p className="mt-3 text-center text-xs text-white/40">PNG, JPG o WEBP · máximo 8 MB por imagen</p>

        <label className="mt-5 block">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/50">
            Describí detalles (opcional)
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            maxLength={600}
            rows={3}
            placeholder='Ej: "cadena plateada más gruesa colgando suelta", "el trébol violeta más brillante", "pelo más largo"'
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 p-3 text-sm text-white placeholder:text-white/30 disabled:opacity-50"
          />
          <span className="mt-1 block text-right text-[10px] text-white/30">{prompt.length}/600</span>
        </label>

        <button
          type="button"
          onClick={primaryAction}
          disabled={busy || (!savedAvatar && (!front || !back))}
          className="mt-5 w-full rounded-2xl bg-violet-400 px-5 py-4 text-sm font-semibold text-black disabled:opacity-50"
        >
          {label}
        </button>

        {errorMsg ? <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200">{errorMsg}</div> : null}

        {resultUrl ? (
          <div className="mt-6 overflow-hidden rounded-3xl border border-violet-300/20 bg-black/35 p-3">
            <model-viewer
              src={resultUrl}
              alt="Avatar CLOUVA generado y riggeado"
              camera-controls
              auto-rotate
              shadow-intensity="1"
              style={{ width: "100%", height: "min(62vh, 540px)", borderRadius: "1.25rem" }}
            />
            <div className="px-2 pb-2 pt-3 text-center">
              <p className="text-sm font-medium text-emerald-300">Avatar creado y riggeado automáticamente ✓</p>
              <Link href="/mi-flow/avatar" className="mt-2 inline-block text-sm text-white/55 underline">
                Abrir en el editor
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      <AvatarLibrary />
    </main>
  );
}
