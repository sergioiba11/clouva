"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClouvaAIChat } from "@/components/clouva-ai/ClouvaAIChat";
import { useTrebolContextRegistration } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { StudioAiProfilePanel, type StudioIdentityState } from "@/components/studio/StudioAiProfilePanel";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type MobileView = "edit" | "preview" | "gemini";

const EMPTY_STATE: StudioIdentityState = {
  publishedVersionNumber: null,
  draftVersionNumber: null,
  staleDraftCount: 0,
  hasUnsavedDraftEdits: false,
  jobStatus: null,
  canPublish: false,
};

export function StudioIdentityWorkspace({
  studioId,
  studioSlug,
  studioName,
}: {
  studioId: string;
  studioSlug: string;
  studioName: string;
}) {
  const [mobileView, setMobileView] = useState<MobileView>("edit");
  const [identityState, setIdentityState] = useState<StudioIdentityState>(EMPTY_STATE);
  const previewPath = `/studio-dashboard/${studioId}/identity-preview`;
  const generating = Boolean(identityState.jobStatus && [
    "queued", "preparing_identity", "analyzing_identity", "generating_copy", "classifying_reference",
    "generating_assets", "generating_variants", "generating_variant_assets", "assembling_profile",
  ].includes(identityState.jobStatus));

  return (
    <div className="pb-28" data-clouva-component="StudioIdentityWorkspace" data-studio-designer="true">
      <div className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/55">Identidad · {studioName}</p>
          <p className="mt-1 text-sm text-white/48">Referencia → Gemini → borrador → preview → publicar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VersionPill label="PUBLICADO" value={identityState.publishedVersionNumber ? `v${identityState.publishedVersionNumber}` : "—"} tone="green" />
          <VersionPill label="BORRADOR" value={identityState.draftVersionNumber ? `v${identityState.draftVersionNumber}` : "SIN BORRADOR"} tone={identityState.draftVersionNumber ? "violet" : "neutral"} />
          {identityState.hasUnsavedDraftEdits ? <VersionPill label="SIN GUARDAR" value="" tone="amber" /> : null}
          {generating ? <VersionPill label="GENERANDO" value="" tone="violet" /> : null}
          <Link href={previewPath} target="_blank" className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/[0.05] hover:text-white">Preview completo</Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 rounded-xl border border-white/10 bg-black/25 p-1 xl:hidden">
        {(["edit", "preview", "gemini"] as MobileView[]).map((view) => (
          <button key={view} type="button" onClick={() => setMobileView(view)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mobileView === view ? "bg-violet-600 text-white" : "text-white/45 hover:text-white"}`}>
            {view === "edit" ? "Editar" : view === "preview" ? "Preview" : "Gemini"}
          </button>
        ))}
      </div>

      <div className="min-w-0 gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className={`${mobileView === "edit" ? "block" : "hidden"} min-w-0 xl:block`}>
          <StudioAiProfilePanel studioId={studioId} onStateChange={setIdentityState} />
        </section>
        <aside className={`${mobileView === "gemini" ? "block" : "hidden"} min-w-0 self-start overflow-hidden rounded-2xl border border-violet-400/15 bg-[#09070f] xl:sticky xl:top-[92px] xl:block xl:h-[calc(100vh-118px)]`}>
          <StudioDesignerGemini studioId={studioId} studioSlug={studioSlug} studioName={studioName} />
        </aside>
      </div>

      <div className={`${mobileView === "preview" ? "block" : "hidden"} mt-5 xl:block`}>
        <EmbeddedPreview studioId={studioId} previewPath={previewPath} />
      </div>
    </div>
  );
}

function StudioDesignerGemini({ studioId, studioSlug, studioName }: { studioId: string; studioSlug: string; studioName: string }) {
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [modelLabel, setModelLabel] = useState("Modelo de diseño");
  const [error, setError] = useState<string | null>(null);

  useTrebolContextRegistration({
    scope: "studio-identity-designer",
    id: studioId,
    data: {
      studioDesigner: true,
      studioDesignerReferenceImageUrls: referenceImageUrls,
      instruction: "Trabajá sobre la identidad draft del Studio. Si el usuario pide una nueva propuesta, usá startStudioProfileGeneration con estas referencias después de la confirmación humana.",
    },
  });

  useEffect(() => {
    let cancelled = false;
    const cookieName = "clouva_gemini_model";
    const previous = readCookie(cookieName);
    void fetch("/api/clouva-ai/models", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { preciseLayoutModel?: string; models?: Array<{ id: string; name?: string }> };
        const model = payload.preciseLayoutModel;
        if (!response.ok || !model || cancelled) return;
        document.cookie = `${cookieName}=${encodeURIComponent(model)}; path=/; SameSite=Lax`;
        const display = payload.models?.find((item) => item.id === model)?.name ?? model;
        setModelLabel(display);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (previous) document.cookie = `${cookieName}=${encodeURIComponent(previous)}; path=/; SameSite=Lax`;
      else document.cookie = `${cookieName}=; path=/; Max-Age=0; SameSite=Lax`;
    };
  }, []);

  const uploadReference = async (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = 3 - referenceImageUrls.length;
    if (remaining <= 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("studioId", studioId);
      Array.from(files).slice(0, remaining).forEach((file) => form.append("images", file));
      const response = await authenticatedFetch("/api/vip-profile/reference-images", { method: "POST", body: form });
      const payload = await readApiJson<{ urls: string[] }>(response);
      setReferenceImageUrls((current) => [...current, ...payload.urls].slice(0, 3));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo adjuntar la referencia.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full min-h-[560px] flex-col" data-clouva-component="StudioDesignerGemini">
      <div className="shrink-0 border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/55">Gemini Designer</p><p className="mt-1 text-xs text-white/42">{modelLabel}</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-[10px] font-semibold text-emerald-200">STUDIO ACTIVO</span></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {referenceImageUrls.map((url, index) => <div key={url} className="group relative h-11 w-14 overflow-hidden rounded-lg border border-white/10"><img src={url} alt={`Referencia ${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => setReferenceImageUrls((current) => current.filter((item) => item !== url))} className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/80 text-[10px]">×</button></div>)}
          {referenceImageUrls.length < 3 ? <label className={`inline-flex h-11 cursor-pointer items-center rounded-lg border border-dashed border-violet-400/25 px-3 text-[11px] font-semibold text-violet-100 ${uploading ? "pointer-events-none opacity-40" : ""}`}>{uploading ? "Subiendo…" : "+ Adjuntar screenshot"}<input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" disabled={uploading} onChange={(event) => void uploadReference(event.target.files)} /></label> : null}
        </div>
        {referenceImageUrls.length ? <p className="mt-2 text-[11px] leading-4 text-white/35">Estas referencias quedan disponibles en el contexto de Gemini y en la tool de nueva generación.</p> : null}
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      </div>
      <div className="min-h-0 flex-1"><ClouvaAIChat studioId={studioId} studioSlug={studioSlug} studioName={studioName} compact /></div>
    </div>
  );
}

function EmbeddedPreview({ studioId, previewPath }: { studioId: string; previewPath: string }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#08070d]" data-clouva-component="StudioIdentityEmbeddedPreview">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/50">Preview real</p><p className="mt-0.5 text-sm text-white/55">Actual · Propuesta · Comparar</p></div>
        <Link href={previewPath} target="_blank" className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white">Abrir pantalla completa</Link>
      </div>
      <iframe key={studioId} title="Preview real de la identidad del Studio" src={previewPath} className="h-[720px] w-full bg-[#050509]" loading="lazy" />
    </section>
  );
}

function VersionPill({ label, value, tone }: { label: string; value: string; tone: "green" | "violet" | "amber" | "neutral" }) {
  const styles = tone === "green" ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-100" : tone === "violet" ? "border-violet-400/25 bg-violet-500/10 text-violet-100" : tone === "amber" ? "border-amber-400/20 bg-amber-400/[0.08] text-amber-100" : "border-white/10 bg-white/[0.035] text-white/45";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-[0.1em] ${styles}`}><span>{label}</span>{value ? <strong>{value}</strong> : null}</span>;
}

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}
