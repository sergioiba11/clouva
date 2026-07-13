"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

type StylePreset = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  artStyle: "realistic" | "cartoon";
};

const STYLES: StylePreset[] = [
  {
    id: "streetwear",
    label: "Streetwear oscuro",
    description: "Oversize, cargos y actitud underground.",
    prompt:
      "A stylized 3D character, young person wearing an oversized black hoodie and black cargo pants with straps and chains, dark streetwear aesthetic, full body, T-pose, clean topology, video game character model",
    artStyle: "cartoon",
  },
  {
    id: "futurista",
    label: "Futurista",
    description: "Techwear, detalles luminosos y silueta cyber.",
    prompt:
      "A stylized 3D character wearing sleek futuristic techwear clothing, cyberpunk streetwear, glowing accents, full body, T-pose, clean topology, video game character model",
    artStyle: "cartoon",
  },
  {
    id: "deportivo",
    label: "Urbano deportivo",
    description: "Conjunto, sneakers y estética de calle.",
    prompt:
      "A stylized 3D character wearing an athletic tracksuit and sneakers, urban sporty streetwear look, full body, T-pose, clean topology, video game character model",
    artStyle: "cartoon",
  },
  {
    id: "realista",
    label: "Realista",
    description: "Proporciones humanas y acabado natural.",
    prompt:
      "A realistic 3D character, young person wearing a black hoodie and dark pants, full body, T-pose, clean topology, game-ready character model",
    artStyle: "realistic",
  },
];

type Phase = "idle" | "preview" | "refining" | "saving" | "done" | "error";

type GenerationResult = {
  status: string;
  model_urls?: { glb?: string };
  task_error?: { message?: string };
};

export default function AvatarIaPage() {
  const { user, session } = useAuth();
  const setActiveAvatar = useActiveAvatarStore((state) => state.setActiveAvatar);
  const [styleId, setStyleId] = useState(STYLES[0].id);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const selectedStyle = STYLES.find((style) => style.id === styleId) ?? STYLES[0];
  const busy = phase === "preview" || phase === "refining" || phase === "saving";

  const poll = async (taskId: string): Promise<GenerationResult> => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const response = await fetch(`/api/meshy/status?taskId=${taskId}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (typeof data.progress === "number") setProgress(data.progress);
      if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(data.status)) return data;
    }
  };

  const generate = async () => {
    setErrorMsg(null);
    setResultUrl(null);
    setProgress(0);

    try {
      if (!user || !session?.access_token) {
        throw new Error("Iniciá sesión para crear y guardar tu avatar.");
      }

      setPhase("preview");
      const createResponse = await fetch("/api/meshy/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: selectedStyle.prompt, artStyle: selectedStyle.artStyle }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error || !created.taskId) {
        throw new Error(created.error || "No se pudo iniciar la creación.");
      }

      const previewResult = await poll(created.taskId);
      if (previewResult.status !== "SUCCEEDED") {
        throw new Error(previewResult.task_error?.message || "No se pudo crear la base del avatar.");
      }

      setPhase("refining");
      setProgress(0);
      const refineResponse = await fetch("/api/meshy/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "refine", previewTaskId: created.taskId }),
      });
      const refined = await refineResponse.json();
      if (!refineResponse.ok || refined.error || !refined.taskId) {
        throw new Error(refined.error || "No se pudo completar el avatar.");
      }

      const refineResult = await poll(refined.taskId);
      if (refineResult.status !== "SUCCEEDED" || !refineResult.model_urls?.glb) {
        throw new Error(refineResult.task_error?.message || "No se pudo terminar el personaje.");
      }

      setPhase("saving");
      const finalizeResponse = await fetch("/api/avatar/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          modelUrl: refineResult.model_urls.glb,
          meshyTaskId: refined.taskId,
          name: `Avatar ${selectedStyle.label}`,
        }),
      });
      const finalized = await finalizeResponse.json();
      if (!finalizeResponse.ok || finalized.error || !finalized.avatar?.model_url) {
        throw new Error(finalized.error || "No se pudo guardar el avatar.");
      }

      const avatar = finalized.avatar;
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

  const buttonLabel = {
    idle: "Crear mi avatar",
    preview: `Construyendo personaje… ${progress}%`,
    refining: `Terminando detalles… ${progress}%`,
    saving: "Guardando en tu cuenta…",
    done: "Crear otra versión",
    error: "Volver a intentar",
  }[phase];

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          href="/mi-flow/avatar"
          className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/75 backdrop-blur-xl transition hover:border-white/25 hover:text-white"
        >
          ← Volver
        </Link>
        <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-white/40">CLOUVA Avatar</span>
      </div>

      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(126,87,255,0.24),transparent_48%),rgba(6,6,12,0.88)] p-5 shadow-2xl shadow-violet-950/30 sm:p-8">
        <div className="max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-violet-300/80">Tu identidad 3D</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">Creá tu personaje CLOUVA</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/60 sm:text-base">
            Elegí una dirección visual. CLOUVA construye una versión 3D única y la deja activa automáticamente en tu cuenta.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {STYLES.map((style) => {
            const active = style.id === styleId;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => setStyleId(style.id)}
                disabled={busy}
                className={`min-h-28 rounded-3xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-violet-400/80 bg-violet-400/15 shadow-lg shadow-violet-950/40"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium text-white">{style.label}</h2>
                    <p className="mt-2 text-sm leading-5 text-white/50">{style.description}</p>
                  </div>
                  <span
                    className={`mt-1 h-4 w-4 shrink-0 rounded-full border ${
                      active ? "border-violet-300 bg-violet-400 shadow-[0_0_18px_rgba(139,92,246,0.8)]" : "border-white/25"
                    }`}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-black/25 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
          <div>
            <p className="text-sm font-medium text-white">{selectedStyle.label}</p>
            <p className="mt-1 text-xs text-white/45">La creación puede demorar unos minutos. Podés dejar esta pantalla abierta.</p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="mt-4 w-full rounded-2xl bg-violet-400 px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-violet-300 disabled:cursor-wait disabled:opacity-65 sm:mt-0 sm:w-auto sm:min-w-56"
          >
            {buttonLabel}
          </button>
        </div>

        {errorMsg ? (
          <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {errorMsg}
          </div>
        ) : null}

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
              <p className="text-sm font-medium text-emerald-300">Tu avatar quedó guardado y activo ✓</p>
              <Link href="/mi-flow/avatar" className="mt-2 inline-block text-sm text-white/55 underline underline-offset-4">
                Abrir en el editor
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
