"use client";

import { useState } from "react";
import Link from "next/link";
import { ClouvaAIChat } from "@/components/clouva-ai/ClouvaAIChat";
import { StudioAiProfilePanel, type StudioIdentityState } from "@/components/studio/StudioAiProfilePanel";

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

      <div className="hidden min-w-0 gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="min-w-0">
          <StudioAiProfilePanel studioId={studioId} onStateChange={setIdentityState} />
        </section>
        <aside className="min-w-0 self-start overflow-hidden rounded-2xl border border-violet-400/15 bg-[#09070f] xl:sticky xl:top-[92px] xl:h-[calc(100vh-118px)]">
          <ClouvaAIChat studioId={studioId} studioSlug={studioSlug} studioName={studioName} compact />
        </aside>
      </div>

      <div className="xl:hidden">
        {mobileView === "edit" ? <StudioAiProfilePanel studioId={studioId} onStateChange={setIdentityState} /> : null}
        {mobileView === "gemini" ? <div className="h-[70vh] min-h-[560px] overflow-hidden rounded-2xl border border-violet-400/15 bg-[#09070f]"><ClouvaAIChat studioId={studioId} studioSlug={studioSlug} studioName={studioName} compact /></div> : null}
        {mobileView === "preview" ? <EmbeddedPreview studioId={studioId} previewPath={previewPath} /> : null}
      </div>

      <div className="mt-5 hidden xl:block">
        <EmbeddedPreview studioId={studioId} previewPath={previewPath} />
      </div>
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
      <iframe
        key={studioId}
        title="Preview real de la identidad del Studio"
        src={previewPath}
        className="h-[720px] w-full bg-[#050509]"
        loading="lazy"
      />
    </section>
  );
}

function VersionPill({ label, value, tone }: { label: string; value: string; tone: "green" | "violet" | "amber" | "neutral" }) {
  const styles = tone === "green"
    ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-100"
    : tone === "violet"
      ? "border-violet-400/25 bg-violet-500/10 text-violet-100"
      : tone === "amber"
        ? "border-amber-400/20 bg-amber-400/[0.08] text-amber-100"
        : "border-white/10 bg-white/[0.035] text-white/45";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-[0.1em] ${styles}`}><span>{label}</span>{value ? <strong>{value}</strong> : null}</span>;
}
