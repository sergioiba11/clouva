"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AvatarLibrary } from "@/components/avatar-engine/AvatarLibrary";
import { cropAvatarTriptych } from "@/lib/avatar-triptych-client";
import {
  AVATAR_REFERENCE_ORDER,
  validateAvatarReferenceFile,
  type AvatarReferenceRole,
} from "@/lib/avatar-triptych";

type Phase = "idle" | "processing" | "uploading" | "generating" | "saving" | "done" | "error";

type TaskResult = {
  status: string;
  progress?: number;
  model_urls?: { glb?: string; pre_remeshed_glb?: string };
  thumbnail_url?: string;
  thumbnail_urls?: string[] | Record<string, string>;
  task_error?: { message?: string };
  error?: { message?: string } | string;
};

type SavedAvatar = {
  id: string;
  model_url: string;
  status: string;
  is_active: boolean;
  front_rotation_y?: number | null;
  updated_at?: string | null;
};

type ReferenceFiles = Record<AvatarReferenceRole, File | null>;
type ReferencePreviews = Record<AvatarReferenceRole, string | null>;

const EMPTY_FILES: ReferenceFiles = { front: null, back: null, side: null };
const EMPTY_PREVIEWS: ReferencePreviews = { front: null, back: null, side: null };
const REFERENCE_LABELS: Record<AvatarReferenceRole, string> = {
  front: "Frente",
  back: "Espalda",
  side: "Costado",
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function taskErrorMessage(task: TaskResult) {
  if (typeof task.error === "string") return task.error;
  return task.task_error?.message || task.error?.message || "No se pudo crear el modelo 3D.";
}

export default function AvatarIaPage() {
  const { user, session } = useAuth();
  const [sheet, setSheet] = useState<File | null>(null);
  const [sheetPreview, setSheetPreview] = useState<string | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFiles>(EMPTY_FILES);
  const [referencePreviews, setReferencePreviews] = useState<ReferencePreviews>(EMPTY_PREVIEWS);
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [savedAvatar, setSavedAvatar] = useState<SavedAvatar | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);

  const cropVersionRef = useRef(0);
  const cropControllerRef = useRef<AbortController | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef(new Set<string>());

  const busy = ["processing", "uploading", "generating", "saving"].includes(phase);
  const referencesReady = AVATAR_REFERENCE_ORDER.every((role) => Boolean(referenceFiles[role]));

  const rememberObjectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  };

  const revokeAllObjectUrls = () => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
  };

  useEffect(() => () => {
    cropVersionRef.current += 1;
    cropControllerRef.current?.abort();
    requestControllerRef.current?.abort();
    revokeAllObjectUrls();
  }, []);

  const pollTask = async (taskId: string, signal: AbortSignal): Promise<TaskResult> => {
    while (!signal.aborted) {
      const response = await fetch(`/api/meshy/status?taskId=${encodeURIComponent(taskId)}&kind=avatar-multi-image`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        cache: "no-store",
        signal,
      });
      const data = await response.json() as TaskResult & { error?: TaskResult["error"] };
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "No se pudo consultar Meshy.");
      if (typeof data.progress === "number") setProgress(Math.max(0, Math.min(100, data.progress)));
      if (["SUCCEEDED", "FAILED", "EXPIRED", "CANCELED"].includes(data.status)) return data;
      await sleep(4000, signal);
    }
    throw new DOMException("Aborted", "AbortError");
  };

  const chooseSheet = async (file: File | null) => {
    const cropVersion = cropVersionRef.current + 1;
    cropVersionRef.current = cropVersion;
    cropControllerRef.current?.abort();
    cropControllerRef.current = null;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    revokeAllObjectUrls();

    setSheet(null);
    setSheetPreview(null);
    setReferenceFiles(EMPTY_FILES);
    setReferencePreviews(EMPTY_PREVIEWS);
    setSourceDimensions(null);
    setResultUrl(null);
    setSavedAvatar(null);
    setProgress(0);
    setErrorMsg(null);
    setPhase("idle");

    if (!file) return;
    const fileError = validateAvatarReferenceFile(file, "La lámina");
    if (fileError) {
      setErrorMsg(fileError);
      setPhase("error");
      return;
    }

    const cropController = new AbortController();
    cropControllerRef.current = cropController;
    setSheet(file);
    setSheetPreview(rememberObjectUrl(file));
    setPhase("processing");

    try {
      const cropped = await cropAvatarTriptych(file, cropController.signal);
      if (cropController.signal.aborted || cropVersionRef.current !== cropVersion) return;

      const nextFiles = { ...EMPTY_FILES };
      const nextPreviews = { ...EMPTY_PREVIEWS };
      const localUrls: string[] = [];

      for (const reference of cropped.references) {
        nextFiles[reference.role] = reference.file;
        const previewUrl = URL.createObjectURL(reference.file);
        localUrls.push(previewUrl);
        nextPreviews[reference.role] = previewUrl;
      }

      if (cropController.signal.aborted || cropVersionRef.current !== cropVersion) {
        localUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      localUrls.forEach((url) => objectUrlsRef.current.add(url));

      setReferenceFiles(nextFiles);
      setReferencePreviews(nextPreviews);
      setSourceDimensions({ width: cropped.sourceWidth, height: cropped.sourceHeight });
      setPhase("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (cropVersionRef.current !== cropVersion) return;
      setErrorMsg(error instanceof Error ? error.message : "No pudimos preparar la lámina.");
      setPhase("error");
    } finally {
      if (cropControllerRef.current === cropController) cropControllerRef.current = null;
    }
  };

  const generate = async () => {
    setErrorMsg(null);
    setResultUrl(null);
    setSavedAvatar(null);
    setProgress(0);

    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;

    try {
      if (!user || !session?.access_token) throw new Error("Iniciá sesión para guardar el avatar.");
      if (!referencesReady) throw new Error("Subí una lámina válida con Frente | Espalda | Costado.");

      setPhase("uploading");
      const form = new FormData();
      for (const role of AVATAR_REFERENCE_ORDER) {
        const file = referenceFiles[role];
        if (!file) throw new Error(`Falta la vista ${REFERENCE_LABELS[role]}.`);
        form.append(role, file, file.name);
      }

      const createResponse = await fetch("/api/avatar/from-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
        signal: controller.signal,
      });
      const created = await createResponse.json();
      if (!createResponse.ok || created.error || !created.taskId) {
        throw new Error(created.error || "No se pudieron enviar las tres referencias.");
      }

      setPhase("generating");
      const generated = await pollTask(created.taskId, controller.signal);
      if (generated.status !== "SUCCEEDED") throw new Error(taskErrorMessage(generated));

      setPhase("saving");
      const saveResponse = await fetch("/api/avatar/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ meshyTaskId: created.taskId }),
        signal: controller.signal,
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok || saved.error || !saved.avatar?.model_url) {
        throw new Error(saved.error || "No se pudo guardar permanentemente el personaje.");
      }
      if (saved.avatar.status !== "pending_analysis" || saved.avatar.is_active !== false) {
        throw new Error("El servidor devolvió un estado de avatar inesperado.");
      }

      const avatar = saved.avatar as SavedAvatar;
      setSavedAvatar(avatar);
      setResultUrl(avatar.model_url);
      setProgress(100);
      setPhase("done");
      setLibraryRevision((value) => value + 1);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErrorMsg(error instanceof Error ? error.message : "Ocurrió un error inesperado.");
      setPhase("error");
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  };

  const label = {
    idle: "Crear personaje 3D",
    processing: "Preparando vistas…",
    uploading: "Subiendo referencias…",
    generating: `Creando modelo 3D… ${progress}%`,
    saving: "Guardando GLB original…",
    done: "Generar otra versión",
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
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300/80">Frente | Espalda | Costado</p>
        <h1 className="mt-3 text-3xl font-semibold text-white sm:text-5xl">Creá el personaje desde una lámina</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
          Subí una única imagen horizontal con frente, espalda y costado izquierdo del mismo personaje. Esta etapa crea y guarda el GLB original de Meshy como borrador, sin ejecutar todavía el Analyzer ni el AutoRig.
        </p>

        <div className="mt-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-white/10 bg-black/25 text-center text-xs font-medium text-white/70">
          <div className="border-r border-white/10 px-2 py-3">Frente</div>
          <div className="border-r border-white/10 px-2 py-3">Espalda</div>
          <div className="px-2 py-3">Costado</div>
        </div>

        <label className="mt-4 block cursor-pointer overflow-hidden rounded-3xl border border-dashed border-violet-300/35 bg-black/25 p-4 text-center">
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
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              void chooseSheet(file);
            }}
          />
        </label>

        <div className="mt-3 text-center text-xs leading-5 text-white/40">
          <p>PNG, JPG o WEBP · máximo 8 MB</p>
          <p>Proporción recomendada 3:1 · resolución recomendada 3072 × 1024</p>
          {sheet && sourceDimensions ? <p className="text-violet-200/65">Lámina detectada: {sourceDimensions.width} × {sourceDimensions.height}</p> : null}
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
          {AVATAR_REFERENCE_ORDER.map((role) => (
            <div key={role} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-2">
              <div className="aspect-square overflow-hidden rounded-xl bg-black/30">
                {referencePreviews[role] ? (
                  <img src={referencePreviews[role] ?? ""} alt={`Vista ${REFERENCE_LABELS[role]}`} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-white/30">Vista pendiente</div>
                )}
              </div>
              <p className="pt-2 text-center text-xs font-medium text-white/65">{REFERENCE_LABELS[role]}</p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || !referencesReady}
          className="mt-6 w-full rounded-2xl bg-violet-400 px-5 py-4 text-sm font-semibold text-black disabled:opacity-50"
        >
          {label}
        </button>

        {errorMsg ? <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200">{errorMsg}</div> : null}

        {resultUrl && savedAvatar ? (
          <div className="mt-6 overflow-hidden rounded-3xl border border-violet-300/20 bg-black/35 p-3">
            <model-viewer
              src={resultUrl}
              alt="Personaje CLOUVA pendiente de análisis"
              camera-controls
              auto-rotate
              shadow-intensity="1"
              style={{ width: "100%", height: "min(62vh, 540px)", borderRadius: "1.25rem" }}
            />
            <div className="px-2 pb-2 pt-3 text-center">
              <p className="text-sm font-medium text-emerald-300">Personaje 3D generado. Revisalo antes de continuar con el Analyzer.</p>
              <p className="mt-2 inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200">
                Pendiente de análisis
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <AvatarLibrary key={libraryRevision} />
    </main>
  );
}
