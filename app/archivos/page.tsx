"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  File,
  FileArchive,
  HardDrive,
  Link2,
  Link2Off,
  LoaderCircle,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import {
  removeClouvaFile,
  signedOwnDownload,
  uploadClouvaFile,
} from "@/lib/clouva-files-upload";

type ClouvaFile = {
  id: string;
  owner_id: string;
  storage_path: string;
  original_name: string;
  size_bytes: number;
  mime_type: string;
  share_token: string;
  is_share_enabled: boolean;
  download_count: number;
  created_at: string;
};

type UploadState = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] ?? "";
}

function fileIcon(name: string) {
  const extension = fileExtension(name);
  const archived = new Set(["zip", "rar", "7z", "tar", "gz", "bz2"]);
  return archived.has(extension) ? FileArchive : File;
}

function shareUrl(token: string) {
  if (typeof window === "undefined") return `/archivos/${token}`;
  return `${window.location.origin}/archivos/${token}`;
}

export default function ArchivosPage() {
  const { user, loading } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<ClouvaFile[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [copied, setCopied] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const loadFiles = useCallback(async () => {
    if (!user) {
      setFiles([]);
      return;
    }
    const { data, error: loadError } = await supabase
      .from("clouva_files")
      .select("id,owner_id,storage_path,original_name,size_bytes,mime_type,share_token,is_share_enabled,download_count,created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    if (loadError) throw loadError;
    setFiles((data ?? []) as ClouvaFile[]);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void loadFiles().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudieron cargar los archivos."));
  }, [user, loadFiles]);

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + Number(file.size_bytes || 0), 0),
    [files],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) =>
      file.original_name.toLowerCase().includes(needle)
      || file.mime_type.toLowerCase().includes(needle)
      || fileExtension(file.original_name).includes(needle),
    );
  }, [files, query]);

  async function uploadSelection(selection: FileList | File[]) {
    if (!user) return;
    const chosen = Array.from(selection);
    if (!chosen.length) return;
    setError("");

    for (const file of chosen) {
      const uploadId = crypto.randomUUID();
      setUploads((current) => [
        ...current,
        { id: uploadId, name: file.name, progress: 0, status: "uploading" },
      ]);

      let uploadedPath = "";
      try {
        const uploaded = await uploadClouvaFile({
          userId: user.id,
          file,
          onProgress: (progress) => {
            setUploads((current) => current.map((item) =>
              item.id === uploadId ? { ...item, progress } : item,
            ));
          },
        });
        uploadedPath = uploaded.objectPath;

        const { error: insertError } = await supabase
          .from("clouva_files")
          .insert({
            owner_id: user.id,
            storage_path: uploaded.objectPath,
            original_name: file.name,
            size_bytes: file.size,
            mime_type: uploaded.mimeType,
          });
        if (insertError) throw insertError;

        setUploads((current) => current.map((item) =>
          item.id === uploadId ? { ...item, progress: 100, status: "done" } : item,
        ));
        await loadFiles();
      } catch (cause) {
        if (uploadedPath) await removeClouvaFile(uploadedPath).catch(() => {});
        const message = cause instanceof Error ? cause.message : "No se pudo subir el archivo.";
        setUploads((current) => current.map((item) =>
          item.id === uploadId ? { ...item, status: "error", error: message } : item,
        ));
        setError(message);
      }
    }

    window.setTimeout(() => {
      setUploads((current) => current.filter((item) => item.status !== "done"));
    }, 2200);
  }

  async function copyShare(file: ClouvaFile) {
    setBusyId(file.id);
    setError("");
    try {
      if (!file.is_share_enabled) {
        const { error: updateError } = await supabase
          .from("clouva_files")
          .update({ is_share_enabled: true })
          .eq("id", file.id);
        if (updateError) throw updateError;
        setFiles((current) => current.map((item) =>
          item.id === file.id ? { ...item, is_share_enabled: true } : item,
        ));
      }
      await navigator.clipboard.writeText(shareUrl(file.share_token));
      setCopied(file.id);
      window.setTimeout(() => setCopied((value) => value === file.id ? "" : value), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo copiar el enlace.");
    } finally {
      setBusyId("");
    }
  }

  async function toggleShare(file: ClouvaFile) {
    setBusyId(file.id);
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("clouva_files")
        .update({ is_share_enabled: !file.is_share_enabled })
        .eq("id", file.id);
      if (updateError) throw updateError;
      setFiles((current) => current.map((item) =>
        item.id === file.id ? { ...item, is_share_enabled: !file.is_share_enabled } : item,
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el enlace.");
    } finally {
      setBusyId("");
    }
  }

  async function downloadFile(file: ClouvaFile) {
    setBusyId(file.id);
    setError("");
    try {
      const url = await signedOwnDownload(file.storage_path, file.original_name);
      window.location.href = url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo preparar la descarga.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteFile(file: ClouvaFile) {
    if (!window.confirm(`Eliminar "${file.original_name}" definitivamente?`)) return;
    setBusyId(file.id);
    setError("");
    try {
      await removeClouvaFile(file.storage_path);
      const { error: deleteError } = await supabase
        .from("clouva_files")
        .delete()
        .eq("id", file.id);
      if (deleteError) throw deleteError;
      setFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar el archivo.");
      await loadFiles().catch(() => {});
    } finally {
      setBusyId("");
    }
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-[#07080d] text-white"><LoaderCircle className="h-6 w-6 animate-spin text-violet-300" /></main>;
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07080d] px-5 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0d0e16] p-7 text-center">
          <HardDrive className="mx-auto h-10 w-10 text-violet-300" />
          <h1 className="mt-4 text-2xl font-semibold">CLOUVA Archivos</h1>
          <p className="mt-2 text-sm leading-6 text-white/45">Iniciá sesión para subir, guardar y compartir archivos.</p>
          <Link href="/login?next=%2Farchivos" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-500 px-5 text-sm font-bold text-white">Iniciar sesión</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#07080d] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 border-b border-white/[0.07] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-violet-300"><HardDrive className="h-5 w-5" /><span className="text-xs font-black uppercase tracking-[0.18em]">CLOUVA</span></div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Archivos</h1>
            <p className="mt-1 text-sm text-white/40">Subí cualquier tipo de archivo y compartilo con un enlace de descarga.</p>
          </div>
          <div className="flex gap-2 text-xs text-white/45">
            <span className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">{files.length} archivos</span>
            <span className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">{formatBytes(totalBytes)}</span>
          </div>
        </header>

        <section
          className={`mt-5 rounded-3xl border border-dashed p-6 text-center transition ${dragging ? "border-violet-300 bg-violet-400/10" : "border-violet-400/25 bg-violet-400/[0.035]"}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void uploadSelection(event.dataTransfer.files);
          }}
        >
          <UploadCloud className="mx-auto h-9 w-9 text-violet-300" />
          <h2 className="mt-3 text-lg font-semibold">Soltá archivos acá</h2>
          <p className="mt-1 text-xs text-white/35">EXE, RAR, ZIP, PDF, audio, video, imágenes, proyectos y cualquier otro formato permitido por tu almacenamiento.</p>
          <button type="button" onClick={() => inputRef.current?.click()} className="mt-4 min-h-11 rounded-xl bg-violet-500 px-5 text-sm font-bold text-white transition hover:bg-violet-400">Seleccionar archivos</button>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => {
            if (event.target.files) void uploadSelection(event.target.files);
            event.currentTarget.value = "";
          }} />
        </section>

        {uploads.length > 0 ? (
          <section className="mt-4 space-y-2">
            {uploads.map((upload) => (
              <div key={upload.id} className="rounded-2xl border border-white/[0.07] bg-[#0d0e16] p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-semibold">{upload.name}</span>
                  <span className={upload.status === "error" ? "text-rose-300" : upload.status === "done" ? "text-emerald-300" : "text-violet-200"}>
                    {upload.status === "error" ? "Error" : upload.status === "done" ? "Listo" : `${upload.progress}%`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-violet-400 transition-[width]" style={{ width: `${upload.progress}%` }} />
                </div>
                {upload.error ? <p className="mt-2 text-[11px] text-rose-300">{upload.error}</p> : null}
              </div>
            ))}
          </section>
        ) : null}

        {error ? <p className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] px-3 py-2 text-xs text-rose-100">{error}</p> : null}

        <div className="mt-6 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar archivos" className="h-11 w-full rounded-xl border border-white/10 bg-[#0d0e16] pl-10 pr-4 text-sm outline-none placeholder:text-white/25 focus:border-violet-400/35" />
          </div>
          <button type="button" onClick={() => inputRef.current?.click()} className="hidden h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold sm:flex"><UploadCloud className="h-4 w-4" /> Subir</button>
        </div>

        <section className="mt-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d0e16]">
          {filtered.length ? filtered.map((file, index) => {
            const Icon = fileIcon(file.original_name);
            const busy = busyId === file.id;
            return (
              <article key={file.id} className={`flex flex-col gap-3 p-3 sm:flex-row sm:items-center ${index ? "border-t border-white/[0.06]" : ""}`}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-400/[0.08] text-violet-200"><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{file.original_name}</p>
                    <p className="mt-1 text-[10px] text-white/32">{formatBytes(file.size_bytes)} · {fileExtension(file.original_name).toUpperCase() || file.mime_type} · {new Date(file.created_at).toLocaleDateString("es-AR")}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" disabled={busy} onClick={() => void downloadFile(file)} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-white/55 hover:bg-white/[0.04] hover:text-white disabled:opacity-40" title="Descargar"><Download className="h-4 w-4" /></button>
                  <button type="button" disabled={busy} onClick={() => void copyShare(file)} className="flex h-9 items-center gap-1.5 rounded-lg border border-violet-300/20 bg-violet-400/[0.05] px-3 text-xs font-semibold text-violet-100 disabled:opacity-40" title="Copiar enlace">
                    {copied === file.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === file.id ? "Copiado" : "Compartir"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void toggleShare(file)} className={`grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-40 ${file.is_share_enabled ? "border-emerald-300/20 text-emerald-300" : "border-white/10 text-white/35"}`} title={file.is_share_enabled ? "Desactivar enlace" : "Activar enlace"}>
                    {file.is_share_enabled ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void deleteFile(file)} className="grid h-9 w-9 place-items-center rounded-lg border border-rose-300/10 text-rose-300/70 hover:bg-rose-300/[0.05] disabled:opacity-40" title="Eliminar"><Trash2 className="h-4 w-4" /></button>
                </div>
              </article>
            );
          }) : (
            <div className="px-4 py-14 text-center">
              <HardDrive className="mx-auto h-8 w-8 text-white/18" />
              <p className="mt-3 text-sm font-semibold text-white/55">{query ? "No encontré archivos" : "Todavía no subiste archivos"}</p>
              <p className="mt-1 text-xs text-white/25">{query ? "Probá otra búsqueda." : "Subí el primero desde el bloque de arriba."}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
