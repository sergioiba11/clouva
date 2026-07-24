"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AvatarLibrary } from "@/components/avatar-engine/AvatarLibrary";
import {
  cropTriptychReferences,
  TRIPTYCH_REFERENCE_ORDER,
  validateTriptychFile,
  type TriptychReferenceKey,
} from "@/lib/avatar/triptych";

type Phase = "idle" | "uploading" | "generating" | "saving" | "done" | "error";

type TaskResult = {
  status: string;
  progress?: number;
  model_urls?: { glb?: string; pre_remeshed_glb?: string };
  thumbnail_url?: string;
  thumbnail_urls?: string[];
  task_error?: { message?: string; code?: string };
  error?: string;
};

type CroppedReference = {
  key: TriptychReferenceKey;
  file: File;
  previewUrl: string;
};

const REFERENCE_LABELS: Record<TriptychReferenceKey, string> = {
  front: "Frente",
  back: "Espalda",
  side: "Costado",
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function AvatarIaPage() {
  const { user, session } = useAuth();
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [sheetPreview, setSheetPreview] = useState<string | null>(null);
  const [references, setReferences] = useState<CroppedReference[]>([]);
  const [processingSheet, setProcessingSheet] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const cropSequenceRef = useRef(0);
  const cropAbortRef = useRef<AbortController | null>(null);
  const temporaryUrlsRef = useRef<string[]>([]);

  const busy = phase === "uploading" || phase === "generating" || phase === "saving";

  const revokeTemporaryUrls = useCallback(() => {
    for (const url of temporaryUrlsRef.current.splice(0)) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => () => {
    cropAbortRef.current?.abort();
    revokeTemporaryUrls();
  }, [revokeTemporaryUrls]);

  const pollTask = async (taskId: string): Promise<TaskResult> => {
    while (true) {
      await sleep(4000);
      const response = await fetch(`/api/meshy/status?taskId=${encodeURIComponent(taskId)}&kind=multi-image`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as TaskResult;
      if (!response.ok || data.error) throw new Error(data.error || "No se pudo consultar la generación.");
      if (typeof data.progress === "number") setProgress(Math.max(0, Math.min(100, data.progress)));
      if (["SUCCEEDED", "FAILED", "EXPIRED", "CANCELED"].includes(data.status)) return data;
    }
  };

  const chooseSheet = async (file: File | null) => {
    cropAbortRef.current?.abort();
    const sequence = cropSequenceRef.current + 1;
    cropSequenceRef.current = sequence;
    revokeTemporaryUrls();
    setSheetFile(null);
    setSheetPreview(null);
    setReferences([]);
    setResultUrl(null);
    setErrorMsg(null);
    setProgress(0);
    setPhase("idle");
    setProcessingSheet(false);

    if (!file) return;
    const fileError = validateTriptychFile(file);
    if (fileError) {
      setErrorMsg(fileError);
      setPhase("error");
      return;
    }

    const originalUrl = URL.createObjectURL(file);
    temporaryUrlsRef.current.push(originalUrl);
    setSheetFile(file);
    setSheetPreview(originalUrl);
    setProcessingSheet(true);
    const controller = new AbortController();
    cropAbortRef.current = controller;

    try {
      const cropped = await cropTriptychReferences(file, controller.signal);
      if (controller.signal.aborted || cropSequenceRef.current !== sequence) return;

      const nextReferences = cropped.map(({ key, file: croppedFile }) => {
        const previewUrl = URL.createObjectURL(croppedFile);
        temporaryUrlsRef.current.push(previewUrl);
        return { key, file: croppedFile, previewUrl };
      });
      setReferences(nextReferences);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (cropSequenceRef.current !== sequence) return;
      setErrorMsg(error instanceof Error ? error.message : "No se pudo preparar la lámina.");
      setPhase("error");
    } finally {
      if (cropSequenceRef.current === sequence) setProcessingSheet(false);
    }
  };

  const generate = async () => {
    setErrorMsg(null);
    setResultUrl(null);
    setProgress(0);

    try {
      if (!user || !session?.access_token) throw new Error("Iniciá sesión para guardar el personaje.");
      const orderedReferences = TRIPTYCH_REFERENCE_ORDER.map((key) => references.find((item) => item.key === key));
      if (orderedReferences.some((item) => !item)) {
        throw new Error("Subí una lámina válida con frente, espalda y costado.");
      }

      setPhase("uploading");
      const form = new FormData();
      for (const reference of orderedReferences) {
        if (reference) form.append(reference.key, reference.file);
      }

      const createResponse = await fetch("/api/avatar/from-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const created = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok || created.error || !created.taskId) {
        throw new Error(created.error || "No se pudieron enviar las tres referencias.");
      }

      setPhase("generating");
      const generated = await pollTask(created.taskId);
      if (generated.status !== "SUCCEEDED") {
        throw new Error(generated.task_error?.message || "No se pudo crear el personaje 3D.");
      }

      setPhase("saving");
      const saveResponse = await fetch("/api/avatar/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          meshyTaskId: created.taskId,
          name: "Personaje 3D CLOUVA",
        }),
      });
      const saved = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || saved.error || !saved.avatar?.model_url) {
        throw new Error(saved.error || "No se pudo guardar permanentemente el personaje.");
      }

      setResultUrl(saved.avatar.model_url);
      setProgress(100);
      setPhase("done");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Ocurrió un error inesperado.");
      setPhase("error");
    }
  };

  const label = {
    idle: "Crear personaje 3D",
    uploading: "Subiendo las tres vistas…",
    generating: `Creando modelo 3D… ${Math.round(progress)}%`,
    saving: "Guardando el GLB original…",
    done: "Crear otra versión",
    error: "Volver a intentar",
  }[phase];

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
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300/80">Lámina del personaje</p>
        <h1 className="mt-3 text-3xl font-semibold text-white sm:text-5xl">Creá el personaje con tres vistas</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
          Prepará una única imagen horizontal con el mismo personaje en este orden: frente, espalda y costado izquierdo.
        </p>

        <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-2xl border border-violet-300/20 bg-violet-400/10 text-center text-xs font-semibold uppercase tracking-[0.14em] text-violet-100 sm:text-sm">
          <span className="border-r border-violet-300/15 px-2 py-3">Frente</span>
          <span className="border-r border-violet-300/15 px-2 py-3">Espalda</span>
          <span className="px-2 py-3">Costado</span>
        </div>

        <label className="mt-5 block cursor-pointer overflow-hidden rounded-3xl border border-dashed border-violet-300/35 bg-black/25 p-4 text-center">
          {sheetPreview ? (
            <img src={sheetPreview} alt="Lámina original del personaje" className="mx-auto aspect-[3/1] w-full rounded-2xl object-contain" />
          ) : (
            <div className="flex aspect-[3/1] items-center justify-center rounded-2xl bg-white/[0.02]">
              <div>
                <p className="text-lg font-medium text-white">Lámina del personaje</p>
                <p className="mt-2 text-sm text-white/45">Subir imagen horizontal</p>
              </div>
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0] ?? null;
              event.currentTarget.value = "";
              void chooseSheet(file);
            }}
          />
        </label>

        <p className="mt-3 text-center text-xs leading-5 text-white/45">
          PNG, JPG o WEBP · máximo 8 MB · proporción recomendada 3:1 · resolución recomendada 3072 × 1024
        </p>

        {processingSheet ? <p className="mt-5 text-center text-sm text-violet-200">Preparando las tres vistas…</p> : null}

        {references.length === 3 ? (
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
            {TRIPTYCH_REFERENCE_ORDER.map((key) => {
              const reference = references.find((item) => item.key === key);
              return (
                <div key={key} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-2 sm:p-3">
                  <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55 sm:text-xs">
                    {REFERENCE_LABELS[key]}
                  </p>
                  {reference ? (
                    <img src={reference.previewUrl} alt={`Vista ${REFERENCE_LABELS[key]}`} className="aspect-square w-full rounded-xl object-contain" />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || processingSheet || !sheetFile || references.length !== 3}
          className="mt-6 w-full rounded-2xl bg-violet-400 px-5 py-4 text-sm font-semibold text-black disabled:opacity-50"
        >
          {label}
        </button>

        {errorMsg ? <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200">{errorMsg}</div> : null}

        {resultUrl ? (
          <div className="mt-6 overflow-hidden rounded-3xl border border-violet-300/20 bg-black/35 p-3">
            <model-viewer
              src={resultUrl}
              alt="Personaje 3D generado por CLOUVA"
              camera-controls
              auto-rotate
              shadow-intensity="1"
              style={{ width: "100%", height: "min(62vh, 540px)", borderRadius: "1.25rem" }}
            />
            <div className="px-2 pb-2 pt-4 text-center">
              <p className="text-sm font-medium text-emerald-300">
                Personaje 3D generado. Revisalo antes de continuar con el Analyzer.
              </p>
              <span className="mt-3 inline-flex rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
                Pendiente de análisis
              </span>
            </div>
          </div>
        ) : null}
      </section>

      <AvatarLibrary />
    </main>
  );
}
