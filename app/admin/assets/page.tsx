"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [bucket, setBucket] = useState("clouva-creator-assets");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("folder", folder);
      if (name.trim()) form.set("name", name.trim());
      const response = await authenticatedFetch("/api/admin/assets", { method: "POST", body: form });
      const data = await readApiJson<UploadResult>(response);
      setMessage(`Subido: ${data.asset.path}`);
      setFile(null);
      setName("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir el archivo.");
    } finally {
      setBusy(false);
    }
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
            <button key={value} type="button" onClick={() => setFolder(value)} className={`rounded-full border px-4 py-2 text-sm ${folder === value ? "border-violet-300 bg-violet-400/15 text-violet-100" : "border-white/10 text-white/60"}`}>
              {value}
            </button>
          ))}
        </div>

        <label className="mt-5 block text-xs uppercase tracking-[0.16em] text-white/50">Archivo</label>
        <input className="mt-2 block w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.glb,.gltf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />

        <label className="mt-4 block text-xs uppercase tracking-[0.16em] text-white/50">Nombre definitivo (opcional)</label>
        <input className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/50" value={name} onChange={(event) => setName(event.target.value)} placeholder={file?.name ?? "ej: logo-official-light.png"} />

        <button type="button" disabled={!file || busy} onClick={() => void upload()} className="mt-5 min-h-14 w-full rounded-full bg-white px-5 font-semibold text-black disabled:opacity-40">
          {busy ? "Subiendo…" : "Subir a CLOUVA"}
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
