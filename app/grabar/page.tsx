"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { supabase } from "@/lib/supabase";

type SavedCapture = {
  name: string;
  created_at: string | null;
  signedUrl?: string;
};

const BUCKET = "clouva-files";

function safeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export default function GrabarPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [userId, setUserId] = useState<string | null>(null);
  const [captures, setCaptures] = useState<SavedCapture[]>([]);
  const [status, setStatus] = useState("Preparando CLOUVA Capture…");
  const [progress, setProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const directStorageEndpoint = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return "";
    const projectRef = new URL(url).hostname.split(".")[0];
    return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }, []);

  async function loadCaptures(uid: string) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(`${uid}/captures`, {
        limit: 30,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (error) {
      setStatus(error.message);
      return;
    }

    const rows = await Promise.all(
      (data ?? [])
        .filter((item) => item.name && item.name !== ".emptyFolderPlaceholder")
        .map(async (item) => {
          const path = `${uid}/captures/${item.name}`;
          const { data: signed } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, 60 * 60);
          return {
            name: item.name,
            created_at: item.created_at ?? null,
            signedUrl: signed?.signedUrl,
          };
        }),
    );

    setCaptures(rows);
  }

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error || !data.user) {
        setStatus("Iniciá sesión en CLOUVA para guardar las grabaciones.");
        return;
      }
      setUserId(data.user.id);
      setStatus("Listo para grabar.");
      void loadCaptures(data.user.id);
    });

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function uploadFile(file: Blob, originalName: string) {
    if (!userId) throw new Error("No hay sesión iniciada.");
    if (!directStorageEndpoint) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL.");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("La sesión expiró. Volvé a iniciar sesión.");

    const extension =
      originalName.split(".").pop()?.toLowerCase() ||
      (file.type.includes("quicktime") ? "mov" : file.type.includes("webm") ? "webm" : "mp4");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = safeName(originalName.replace(/\.[^.]+$/, "")) || "iphone-capture";
    const objectName = `${userId}/captures/${timestamp}-${base}.${extension}`;

    setBusy(true);
    setProgress(0);
    setStatus("Subiendo a CLOUVA…");

    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: directStorageEndpoint,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        chunkSize: 6 * 1024 * 1024,
        headers: {
          authorization: `Bearer ${token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        },
        metadata: {
          bucketName: BUCKET,
          objectName,
          contentType: file.type || "video/mp4",
          cacheControl: "3600",
        },
        removeFingerprintOnSuccess: true,
        onError(error) {
          setBusy(false);
          reject(error);
        },
        onProgress(uploaded, total) {
          setProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0);
        },
        onSuccess() {
          resolve();
        },
      });

      upload.findPreviousUploads().then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(reject);
    });

    setBusy(false);
    setProgress(100);
    setStatus("Guardado en CLOUVA.");
    await loadCaptures(userId);
  }

  async function onNativeCapture(file?: File) {
    if (!file) return;
    try {
      await uploadFile(file, file.name || "iphone-camera.mov");
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : "No se pudo subir la grabación.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function enableBrowserCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play();
      }
      setCameraReady(true);
      setStatus("Cámara lista.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo abrir la cámara.");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = pickRecorderMimeType();
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "video/mp4";
      const extension = type.includes("webm") ? "webm" : "mp4";
      const blob = new Blob(chunksRef.current, { type });
      void uploadFile(blob, `clouva-browser-${Date.now()}.${extension}`).catch((error) => {
        setBusy(false);
        setStatus(error instanceof Error ? error.message : "No se pudo subir la grabación.");
      });
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording(true);
    setStatus("Grabando…");
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    setRecording(false);
    setStatus("Procesando grabación…");
  }

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.28em] text-white/45">CLOUVA CAPTURE</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Grabar directo a CLOUVA</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
            Desde iPhone podés abrir la cámara nativa o grabar dentro del navegador. Al terminar,
            el video se sube directo a tu espacio privado de CLOUVA.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!userId || busy}
            className="rounded-3xl border border-white/15 bg-white px-6 py-8 text-left text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-black/45">Mejor calidad</span>
            <span className="mt-3 block text-2xl font-semibold">Cámara iPhone</span>
            <span className="mt-2 block text-sm text-black/60">Abre la cámara nativa y sube el archivo al terminar.</span>
          </button>

          <button
            type="button"
            onClick={enableBrowserCamera}
            disabled={!userId || busy}
            className="rounded-3xl border border-white/15 bg-white/[0.06] px-6 py-8 text-left transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-white/45">Preview en vivo</span>
            <span className="mt-3 block text-2xl font-semibold">Grabar acá</span>
            <span className="mt-2 block text-sm text-white/60">Usa cámara trasera + micrófono desde Safari.</span>
          </button>
        </section>

        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="video/*"
          capture="environment"
          onChange={(event) => void onNativeCapture(event.target.files?.[0])}
        />

        <section className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
          <div className="aspect-video bg-black">
            <video ref={previewRef} muted playsInline className="h-full w-full object-cover" />
          </div>
          <div className="flex flex-wrap items-center gap-3 p-4">
            {!recording ? (
              <button
                type="button"
                onClick={startRecording}
                disabled={!cameraReady || busy}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
              >
                Grabar
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white"
              >
                Detener y guardar
              </button>
            )}
            <span className="text-sm text-white/55">{status}</span>
          </div>
          {busy && (
            <div className="h-1 bg-white/10">
              <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Grabaciones</h2>
            <span className="text-xs text-white/40">{captures.length} archivos</span>
          </div>

          <div className="grid gap-3">
            {captures.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-5 py-8 text-sm text-white/45">
                Todavía no hay grabaciones.
              </div>
            ) : (
              captures.map((item) => (
                <article key={item.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="mt-1 text-xs text-white/40">
                        {item.created_at ? new Date(item.created_at).toLocaleString("es-AR") : "Guardado en CLOUVA"}
                      </p>
                    </div>
                    {item.signedUrl && (
                      <a
                        href={item.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-full border border-white/15 px-4 py-2 text-xs font-medium hover:bg-white/10"
                      >
                        Ver
                      </a>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
