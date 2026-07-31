"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type ProfileCopy = {
  tagline: string | null;
  short_bio: string | null;
  seo_title: string | null;
  seo_description: string | null;
  share_title: string | null;
  share_description: string | null;
  visual_energy: string | null;
  visual_tone: string | null;
  palette: string[] | null;
};

type GeneratedAsset = { kind: string; url: string };

type Job = {
  id: string;
  status: string;
  generated_copy: ProfileCopy | null;
  generated_assets: GeneratedAsset[] | null;
  error_message: string | null;
  actual_cost_usd: number | null;
} | null;

type Version = {
  id: string;
  version_number: number;
  status: "draft" | "review" | "published" | "archived";
  profile_level: "basic" | "vip";
  copy_config: ProfileCopy;
  asset_references: GeneratedAsset[];
  published_at: string | null;
};

const IN_PROGRESS_STATUSES = new Set([
  "queued", "preparing_identity", "analyzing_identity", "generating_copy", "generating_assets", "assembling_profile",
]);

// Real states only -- no invented percentages (spec section 18).
const STATUS_LABEL: Record<string, string> = {
  queued: "En cola...",
  preparing_identity: "Preparando tu identidad...",
  analyzing_identity: "Analizando tu estilo...",
  generating_copy: "Escribiendo tu presentación...",
  generating_assets: "Creando tu portada...",
  assembling_profile: "Armando tu perfil...",
  review_ready: "Listo para revisar.",
  failed: "Algo falló en la generación.",
  blocked_budget: "El presupuesto compartido de Gemini no está disponible ahora mismo.",
  needs_user_input: "Necesitamos más información tuya para continuar.",
  cancelled: "Generación cancelada.",
};

const EDITABLE_FIELDS: Array<{ key: keyof ProfileCopy; label: string; multiline?: boolean }> = [
  { key: "tagline", label: "Frase de identidad" },
  { key: "short_bio", label: "Biografía" , multiline: true },
  { key: "seo_title", label: "Título SEO" },
  { key: "seo_description", label: "Descripción SEO", multiline: true },
  { key: "share_title", label: "Título al compartir" },
  { key: "share_description", label: "Descripción al compartir", multiline: true },
];

export function VipAiProfilePanel({ playerId, vipActive }: { playerId: string; vipActive: boolean }) {
  const [job, setJob] = useState<Job>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Partial<ProfileCopy>>({});
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    try {
      const response = await authenticatedFetch(`/api/vip-profile/status?playerId=${encodeURIComponent(playerId)}`);
      const payload = await readApiJson<{ job: Job; versions: Version[] }>(response);
      setJob(payload.job);
      setVersions(payload.versions);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar CLOUVA AI Profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [playerId]);

  useEffect(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (job && IN_PROGRESS_STATUSES.has(job.status)) {
      pollRef.current = window.setInterval(() => { void load(); }, 4000);
    }
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [job?.status]);

  const draftVersion = versions.find((v) => v.status === "draft");
  const publishedVipVersion = versions.find((v) => v.status === "published" && v.profile_level === "vip");

  const startGeneration = async () => {
    setStarting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/vip-profile/generate", {
        method: "POST",
        body: JSON.stringify({ playerId }),
      });
      await readApiJson(response);
      await load();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "No se pudo iniciar la generación.");
    } finally {
      setStarting(false);
    }
  };

  const saveEdits = async () => {
    if (!draftVersion || Object.keys(draftEdits).length === 0) return;
    setStarting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/vip-profile/versions/${draftVersion.id}`, {
        method: "PATCH",
        body: JSON.stringify(draftEdits),
      });
      await readApiJson(response);
      setDraftEdits({});
      setMessage("Cambios guardados.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudieron guardar los cambios.");
    } finally {
      setStarting(false);
    }
  };

  const publish = async () => {
    if (!draftVersion) return;
    if (Object.keys(draftEdits).length > 0) await saveEdits();
    setStarting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/vip-profile/versions/${draftVersion.id}/publish`, { method: "POST" });
      await readApiJson(response);
      setMessage("Versión profesional publicada.");
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "No se pudo publicar.");
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />;

  if (!vipActive && !publishedVipVersion) {
    return (
      <div className="rounded-2xl border border-dashed border-violet-400/25 bg-violet-500/[0.04] p-6 text-center">
        <p className="text-lg font-semibold">CLOUVA AI Profile</p>
        <p className="mt-2 text-sm text-white/55">Activá CLOUVA VIP para transformar tu carta gratuita en una versión profesional con Gemini: portada generada, biografía pulida y copy optimizado.</p>
        <Link href="/vip" className="mt-4 inline-block rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-5 py-3 font-semibold">Ver CLOUVA VIP</Link>
      </div>
    );
  }

  const cover = draftVersion?.asset_references.find((a) => a.kind === "cover")
    ?? job?.generated_assets?.find((a) => a.kind === "cover");
  const logo = draftVersion?.asset_references.find((a) => a.kind === "logo")
    ?? job?.generated_assets?.find((a) => a.kind === "logo");
  const copy = draftVersion?.copy_config ?? job?.generated_copy;
  const palette = copy?.palette ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-violet-400/25 bg-violet-500/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">CLOUVA VIP activo</p>
          <p className="mt-1 text-sm text-white/60">{publishedVipVersion ? `Versión profesional publicada (v${publishedVipVersion.version_number}).` : "Todavía no creaste tu versión profesional."}</p>
        </div>
        {!job || !IN_PROGRESS_STATUSES.has(job.status) ? (
          <button disabled={starting} onClick={() => void startGeneration()} className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
            {publishedVipVersion ? "Crear nueva versión" : "Crear mi versión profesional"}
          </button>
        ) : null}
      </div>

      {job && IN_PROGRESS_STATUSES.has(job.status) ? (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-5">
          <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
          <p className="text-sm text-white/70">{STATUS_LABEL[job.status] ?? job.status}</p>
        </div>
      ) : null}

      {job && (job.status === "failed" || job.status === "blocked_budget" || job.status === "needs_user_input") ? (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-200">{STATUS_LABEL[job.status]}{job.error_message ? ` — ${job.error_message}` : ""}</p>
      ) : null}

      {draftVersion && copy ? (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Revisá y editá tu versión profesional (v{draftVersion.version_number}, borrador)</p>
          {cover ? <img src={cover.url} alt="" className="h-40 w-full rounded-xl object-cover" /> : null}
          {logo || palette.length > 0 ? (
            <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-black/20 p-4">
              {logo ? <img src={logo.url} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-black/30 object-contain" /> : null}
              {palette.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs uppercase tracking-[0.16em] text-white/40">Paleta sugerida</p>
                  <div className="flex gap-2">
                    {palette.map((hex) => <span key={hex} title={hex} className="h-7 w-7 rounded-full border border-white/20" style={{ backgroundColor: hex }} />)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.map(({ key, label, multiline }) => {
              const value = String((draftEdits[key] ?? copy[key]) ?? "");
              const onChange = (next: string) => setDraftEdits((current) => ({ ...current, [key]: next }));
              return (
                <div key={key} className={multiline ? "sm:col-span-2" : ""}>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</label>
                  {multiline ? (
                    <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60" />
                  ) : (
                    <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={starting || Object.keys(draftEdits).length === 0} onClick={() => void saveEdits()} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm disabled:opacity-40">Guardar cambios</button>
            <button disabled={starting} onClick={() => void publish()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">Publicar versión profesional</button>
          </div>
        </div>
      ) : null}

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message}</p> : null}
    </div>
  );
}
