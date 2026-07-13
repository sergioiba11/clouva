"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AvatarLibrary } from "@/components/avatar-engine/AvatarLibrary";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

type Phase = "idle" | "uploading" | "generating" | "saving" | "done" | "error";

type TaskResult = {
  status: string;
  progress?: number;
  model_urls?: { glb?: string };
  task_error?: { message?: string };
};

export default function AvatarIaPage() {
  const { user, session } = useAuth();
  const setActiveAvatar = useActiveAvatarStore((state) => state.setActiveAvatar);
  const [reference, setReference] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const busy = phase === "uploading" || phase === "generating" || phase === "saving";

  const pollTask = async (taskId: string): Promise<TaskResult> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const response = await fetch(`/api/meshy/status?taskId=${taskId}&kind=multi-image`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (typeof data.progress === "number") setProgress(data.progress);
      if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(data.status)) return data;
    }
  };

  const chooseReference = (file: File | null) => {
    if (referencePreview) URL.revokeObjectURL(referencePreview);
    setReference(file);
    setReferencePreview(file ? URL.createObjectURL(file) : null);
    setResultUrl(null);
    setErrorMsg(null);
    setPhase("idle");
  };

  const generate = async () => {
    setErrorMsg(null);
    setResultUrl(null);
    setProgress(0);

    try {
      if (!user || !session?.access_token) throw new Error("Iniciá sesión para guardar el avatar.");
      if (!reference) throw new Error("Subí una imagen de referencia.");

      setPhase("uploading");
      const form = new FormData();
      form.append("image", reference);

      const createResponse = await fetch("/api/avatar/from-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error || !created.taskId) {
        throw new Error(created.error || "No se pudo enviar la referencia.");
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

      const avatar = saved.avatar;
      setResultUrl(avatar.model_url);
      setActiveAvatar({
        id: avatar.id,
        source: "generated",
        modelUrl: avatar.model_url,
        fallbackUrl: null,
        status: "ready",
        frontRotationY: Number(avatar.front_rotation_y ?? 0),
        updatedAt: avatar.updated_at ?? new Date().toISOString(),
      });
      setPhase("done");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Ocurrió un error inesperado.");
      setPhase("error");
    }
  };

  const label = {
    idle: "Crear personaje 3D",
    uploading: "Subiendo referencia…",
    generating: `Creando modelo 3D… ${progress}%`,
    saving: "Guardando en tu cuenta…",
    done: "Crear otra versión",
    error: "Volver a intentar",
  }[phase];

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-24 pt-5 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/mi-flow/avatar" className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/75">
          ← Volver
        </Link>
        <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">CLOUVA Avatar</span>
      </div>

      <section className="rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(126,87,255,0.24),transparent_48%),rgba(6,6,12,0.9)] p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300/80">Referencia a 3D</p>
        <h1 className="mt-3 text-3xl font-semibold text-white sm:text-5xl">Creá el personaje desde una imagen</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
          Subí el diseño del personaje. CLOUVA usa esa imagen como referencia visual para generar el modelo 3D y guardarlo en tu cuenta.
        </p>

        <label className="mt-7 block cursor-pointer overflow-hidden rounded-3xl border border-dashed border-violet-300/35 bg-black/25 p-4 text-center">
          {referencePreview ? (
            <img src={referencePreview} alt="Referencia seleccionada" className="mx-auto max-h-[520px] w-full rounded-2xl object-contain" />
          ) : (
            <div className="py-16">
              <p className="text-lg font-medium text-white">Subir imagen</p>
              <p className="mt-2 text-sm text-white/45">PNG, JPG o WEBP · máximo 8 MB</p>
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(event) => chooseReference(event.target.files?.[0] ?? null)}
          />
        </label>

        <button
          type="button"
          onClick={generate}
          disabled={busy || !reference}
          className="mt-5 w-full rounded-2xl bg-violet-400 px-5 py-4 text-sm font-semibold text-black disabled:opacity-50"
        >
          {label}
        </button>

        {errorMsg ? <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200">{errorMsg}</div> : null}

        {resultUrl ? (
          <div className="mt-6 overflow-hidden rounded-3xl border border-violet-300/20 bg-black/35 p-3">
            <model-viewer
              src={resultUrl}
              alt="Avatar CLOUVA generado"
              camera-controls
              auto-rotate
              shadow-intensity="1"
              style={{ width: "100%", height: "min(62vh, 540px)", borderRadius: "1.25rem" }}
            />
            <div className="px-2 pb-2 pt-3 text-center">
              <p className="text-sm font-medium text-emerald-300">Guardado y activo ✓</p>
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
