"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Asset = {
  name: string;
  path: string;
  url: string;
  size: number;
  contentType: string | null;
  updatedAt: string | null;
};

type AssetList = { bucket: string; folder: string; items: Asset[] };
type UploadResult = { asset: Asset };

const FOLDERS = ["brand", "backgrounds", "players", "products", "3d", "uploads"];

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export default function AdminAssetsPage() {
  const [folder, setFolder] = useState("brand");
  const [items, setItems] = useState<Asset[]>([]);
  const [bucket, setBucket] = useState("clouva-generated-media");
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastHandledSelectionRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`/api/admin/assets?folder=${encodeURIComponent(folder)}`);
      const data = await readApiJson<AssetList>(response);
      setItems(data.items);
      setBucket(data.bucket);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los assets.");
    }
  }, [folder]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (selectedFiles?: File[]) => {
    const uploadFiles = selectedFiles ?? files;
    if (!uploadFiles.length || busy) return;

    setBusy(true);
    const failures: File[] = [];
    let uploaded = 0;

    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const uploadFile = uploadFiles[index];
        setMessage(`Subiendo ${index + 1}/${uploadFiles.length}: ${uploadFile.name}…`);

        try {
          const form = new FormData();
          form.set("file", uploadFile);
          form.set("folder", folder);
          if (uploadFiles.length === 1 && name.trim()) form.set("name", name.trim());

          const response = await authenticatedFetch("/api/admin/assets", { method: "POST", body: form });
          await readApiJson<UploadResult>(response);
          uploaded += 1;
        } catch {
          failures.push(uploadFile);
        }
      }

      if (failures.length) {
        setFiles(failures);
        setMessage(`${uploaded}/${uploadFiles.length} archivos subidos. Fallaron ${failures.length}; podés reintentar.`);
      } else {
        setFiles([]);
        setName("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        lastHandledSelectionRef.current = null;
        setMessage(uploadFiles.length === 1 ? `Subido: ${uploadFiles[0].name}` : `${uploaded} archivos subidos correctamente.`);
      }

      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleSelectedFiles = (input: HTMLInputElement) => {
    const picked = Array.from(input.files ?? []);
    if (!picked.length) return;

    const selectionKey = picked.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
    if (lastHandledSelectionRef.current === selectionKey) return;
    lastHandledSelectionRef.current = selectionKey;

    setFiles(picked);
    setMessage(`${picked.length} archivo${picked.length === 1 ? "" : "s"} seleccionado${picked.length === 1 ? "" : "s"}. Subiendo…`);
    void upload(picked);
  };

  return (
    <div className="space-y-5 pb-24">
      <div className="rounded-[2rem] border border-violet-400/20 bg-black/30 p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-violet-300">CLOUVA Assets</p>
        <h1 className="mt-2 text-3xl font-semibold">Subir desde el celu</h1>
        <p className="mt-2 text-sm text-white/55">Bucket: {bucket}. Los archivos quedan persistentes en Google Cloud Storage.</p>
      </div>

      <div className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-5">
        <label className="text-xs uppercase tracking-[0.16em] text-white/50">Carpeta</label>
        <div className="mt-3 flex flex-wrap gap-2">
          {FOLDERS.map((value) => (
            <button key={value} type="button" disabled={busy} onClick={() => setFolder(value)} className={`rounded-full border px-4 py-2 text-sm disabled:opacity-40 ${folder === value ? "border-violet-300 bg-violet-400/15 text-violet-100" : "border-white/10 text-white/60"}`}>
              {value}
            </button>
          ))}
        </div>

        <label className="mt-5 block text-xs uppercase tracking-[0.16em] text-white/50">Nombre definitivo (opcional)</label>
        <input className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/50" value={name} disabled={busy || files.length > 1} onChange={(event) => setName(event.target.value)} placeholder="ej: logo-official-light.png" />
        <p className="mt-2 text-xs text-white/40">Si elegís varios archivos, se conserva automáticamente el nombre original de cada uno.</p>

        <label className="mt-5 block text-xs uppercase tracking-[0.16em] text-white/50">Archivos</label>
        <input
          ref={fileInputRef}
          className="mt-2 block w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm"
          type="file"
          multiple
          accept="image/*,.glb,.gltf,.pdf,application/pdf,model/gltf-binary,model/gltf+json"
          disabled={busy}
          onClick={(event) => {
            event.currentTarget.value = "";
            lastHandledSelectionRef.current = null;
          }}
          onInput={(event) => handleSelectedFiles(event.currentTarget)}
          onChange={(event) => handleSelectedFiles(event.currentTarget)}
        />
        <p className="mt-2 text-xs text-white/45">Podés elegir varias imágenes o archivos de una vez. Se suben automáticamente uno por uno.</p>

        {files.length ? (
          <div className="mt-3 rounded-2xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100">
            <p className="font-medium">{files.length} archivo{files.length === 1 ? "" : "s"} seleccionado{files.length === 1 ? "" : "s"}</p>
            <div className="mt-2 space-y-1 text-xs text-white/55">
              {files.slice(0, 6).map((selectedFile) => (
                <p key={`${selectedFile.name}:${selectedFile.lastModified}`} className="truncate">{selectedFile.name} · {formatBytes(selectedFile.size)}</p>
              ))}
              {files.length > 6 ? <p>+{files.length - 6} más</p> : null}
            </div>
          </div>
        ) : null}

        <button type="button" disabled={!files.length || busy} onClick={() => void upload()} className="mt-5 min-h-14 w-full rounded-full bg-white px-5 font-semibold text-black disabled:opacity-40">
          {busy ? "Subiendo…" : files.length > 1 ? `Reintentar ${files.length} archivos` : "Reintentar subida"}
        </button>
        {message ? <p className="mt-3 break-all text-sm text-violet-200">{message}</p> : null}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">/{folder}</h2>
          <button type="button" onClick={() => void load()} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65">Actualizar</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((asset) => (
            <article key={asset.path} className="overflow-hidden rounded-2xl border border-white/10 bg-black/25">
              {asset.contentType?.startsWith("image/") ? <img src={asset.url} alt="" className="aspect-video w-full bg-white/[0.03] object-contain" /> : <div className="grid aspect-video place-items-center text-sm text-white/35">{asset.contentType ?? "archivo"}</div>}
              <div className="p-3">
                <p className="truncate text-sm font-medium">{asset.name}</p>
                <p className="mt-1 text-xs text-white/40">{formatBytes(asset.size)}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void navigator.clipboard.writeText(asset.url)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs">Copiar URL</button>
                  <a href={asset.url} target="_blank" rel="noreferrer" className="rounded-full border border-violet-400/25 px-3 py-1.5 text-xs text-violet-200">Abrir</a>
                </div>
              </div>
            </article>
          ))}
          {!items.length ? <p className="text-sm text-white/45">Todavía no hay archivos en esta carpeta.</p> : null}
        </div>
      </section>
    </div>
  );
}
