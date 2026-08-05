"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, RefreshCw, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

type Release = {
  id: string;
  app_name: string;
  version: string;
  build_number: number;
  file_size: number | null;
  checksum: string;
  release_notes: string | null;
  is_stable: boolean;
  minimum_required: string | null;
  created_at: string;
  published_at: string | null;
};

function bytes(value: number | null) {
  if (!value) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default function ClouvaControlAdminPage() {
  const { session } = useAuth();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = session?.access_token ?? null;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/clouva-control/releases", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron cargar las versiones");
      setReleases(payload.releases ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = useMemo(() => releases.find((release) => release.is_stable) ?? releases[0] ?? null, [releases]);

  async function download(release: Release) {
    if (!token) return;
    setDownloading(release.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/clouva-control/releases/${release.id}/download`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo preparar la descarga");
      window.location.assign(payload.signedUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error desconocido");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="overflow-hidden rounded-3xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.28),transparent_42%),linear-gradient(145deg,rgba(10,10,18,0.98),rgba(18,10,34,0.98))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-violet-200">
              <ShieldCheck className="h-4 w-4" /> Acceso privado de administrador
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">CLOUVA CONTROL</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/65 md:text-base">
              Descargá la aplicación Android privada para revisar rutas, probar experiencias, observar procesos y registrar problemas desde el celular sin abrir Chrome.
            </p>
          </div>
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[2rem] border border-violet-300/20 bg-black/35 shadow-[0_0_42px_rgba(139,92,246,0.28)]">
            <Smartphone className="h-11 w-11 text-violet-200" />
          </div>
        </div>
      </header>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /> {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Versión estable</h2>
            <p className="mt-1 text-sm text-white/50">El APK se entrega con una URL firmada que vence automáticamente.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center gap-3 text-white/60"><LoaderCircle className="h-5 w-5 animate-spin" /> Cargando releases...</div>
        ) : latest ? (
          <div className="grid gap-4 rounded-2xl border border-violet-300/15 bg-black/25 p-4 md:grid-cols-[1fr_auto] md:items-center md:p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-black text-white">v{latest.version}</span>
                <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-bold text-emerald-200">ESTABLE</span>
                <span className="text-xs text-white/40">build {latest.build_number}</span>
              </div>
              <div className="mt-3 grid gap-1 text-sm text-white/60 sm:grid-cols-2">
                <span>Tamaño: {bytes(latest.file_size)}</span>
                <span>Publicada: {new Date(latest.published_at ?? latest.created_at).toLocaleString("es-AR")}</span>
                <span className="sm:col-span-2 break-all font-mono text-xs text-white/35">SHA-256: {latest.checksum}</span>
              </div>
              {latest.release_notes ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-white/70">{latest.release_notes}</p> : null}
            </div>
            <button onClick={() => void download(latest)} disabled={downloading === latest.id} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 font-bold text-white shadow-[0_0_28px_rgba(124,58,237,0.32)] transition hover:bg-violet-500 disabled:opacity-50">
              {downloading === latest.id ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
              Descargar APK
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/55">
            Todavía no hay un APK publicado. Ejecutá el workflow <strong className="text-white">Build CLOUVA CONTROL APK</strong> para generar el primero.
          </div>
        )}
      </section>

      {releases.length > 1 ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 md:p-6">
          <h2 className="mb-4 text-lg font-bold text-white">Historial</h2>
          <div className="space-y-2">
            {releases.map((release) => (
              <div key={release.id} className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-bold text-white">v{release.version} <span className="text-xs font-normal text-white/40">build {release.build_number}</span></div>
                  <div className="mt-1 text-xs text-white/45">{bytes(release.file_size)} · {new Date(release.created_at).toLocaleString("es-AR")}</div>
                </div>
                <button onClick={() => void download(release)} disabled={downloading === release.id} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">
                  <Download className="h-4 w-4" /> Descargar
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
