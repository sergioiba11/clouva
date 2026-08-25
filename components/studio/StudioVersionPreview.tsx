"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Columns2, ExternalLink, RefreshCw } from "lucide-react";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { StudioIdentityData } from "@/lib/server/public-identity-data";
import type { StudioVersionSnapshot } from "@/lib/server/studio-version-preview";

type PreviewMode = "actual" | "proposal" | "compare";

type PreviewPayload = {
  studioId: string;
  canonicalPath: string;
  current: StudioIdentityData;
  proposal: StudioIdentityData | null;
  publishedVersion: StudioVersionSnapshot | null;
  draftVersion: StudioVersionSnapshot | null;
};

type PreviewWindow = Window & {
  __CLOUVA_VERSION_PREVIEW__?: Record<string, unknown>;
};

function VersionBadge({ label, version, tone }: {
  label: string;
  version: StudioVersionSnapshot | null;
  tone: "current" | "proposal";
}) {
  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${tone === "current" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" : "border-violet-400/30 bg-violet-500/10 text-violet-100"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone === "current" ? "bg-emerald-400" : "bg-violet-400"}`} />
      <strong>{label}</strong>
      <span className="opacity-60">{version ? `v${version.version_number}` : "sin versión AI"}</span>
    </div>
  );
}

export function StudioVersionPreview({ studioId }: { studioId: string }) {
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [mode, setMode] = useState<PreviewMode>("proposal");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await authenticatedFetch(`/api/vip-profile/studio-preview?studioId=${encodeURIComponent(studioId)}`);
      const next = await readApiJson<PreviewPayload>(response);
      setPayload(next);
      setError(null);
      if (!next.proposal) setMode("actual");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el Preview.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [studioId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const context = {
      kind: "studio-version",
      studioId,
      studioName: payload?.current.studio.name ?? null,
      publishedVersionId: payload?.publishedVersion?.id ?? null,
      draftVersionId: payload?.draftVersion?.id ?? null,
      mode,
      page: "studio-identity",
      canonicalPath: payload?.canonicalPath ?? null,
    };
    const root = document.documentElement;
    root.dataset.clouvaPreviewKind = "studio-version";
    root.dataset.clouvaStudioId = studioId;
    root.dataset.clouvaPreviewMode = mode;
    root.dataset.clouvaPreviewPage = "studio-identity";
    if (payload?.publishedVersion?.id) root.dataset.clouvaPublishedVersionId = payload.publishedVersion.id;
    else delete root.dataset.clouvaPublishedVersionId;
    if (payload?.draftVersion?.id) root.dataset.clouvaDraftVersionId = payload.draftVersion.id;
    else delete root.dataset.clouvaDraftVersionId;
    (window as PreviewWindow).__CLOUVA_VERSION_PREVIEW__ = context;
    return () => {
      delete root.dataset.clouvaPreviewKind;
      delete root.dataset.clouvaStudioId;
      delete root.dataset.clouvaPreviewMode;
      delete root.dataset.clouvaPreviewPage;
      delete root.dataset.clouvaPublishedVersionId;
      delete root.dataset.clouvaDraftVersionId;
      delete (window as PreviewWindow).__CLOUVA_VERSION_PREVIEW__;
    };
  }, [mode, payload, studioId]);

  if (loading && !payload) {
    return <main className="grid min-h-screen place-items-center bg-[#050509] text-sm text-white/60">Cargando versiones reales del Estudio…</main>;
  }

  if (!payload) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#050509] p-6 text-white">
        <div className="max-w-lg rounded-2xl border border-red-400/20 bg-red-400/10 p-6">
          <strong>No se pudo abrir el Preview</strong>
          <p className="mt-2 text-sm text-red-100/70">{error}</p>
          <button onClick={() => void load()} className="mt-4 rounded-xl border border-white/15 px-4 py-2 text-sm">Reintentar</button>
        </div>
      </main>
    );
  }

  const visibleProposal = payload.proposal ?? payload.current;

  return (
    <main className="min-h-screen bg-[#050509] text-white" data-clouva-component="StudioVersionPreview" data-clouva-studio-id={studioId} data-clouva-preview-mode={mode}>
      <header className="sticky top-0 z-[100] flex min-h-14 flex-wrap items-center gap-3 border-b border-white/10 bg-[#08070d]/95 px-3 py-2 shadow-2xl backdrop-blur-xl sm:px-5">
        <Link href={`/studio-dashboard/${studioId}`} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/60 transition hover:bg-white/5 hover:text-white">
          <ArrowLeft size={14} /> Administrar
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{payload.current.studio.name}</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Preview canónico de identidad</p>
        </div>
        <VersionBadge label="ACTUAL" version={payload.publishedVersion} tone="current" />
        {payload.draftVersion ? <VersionBadge label="PROPUESTA" version={payload.draftVersion} tone="proposal" /> : null}
        <div className="flex rounded-xl border border-white/10 bg-black/30 p-1">
          {(["actual", "proposal", "compare"] as const).map((item) => (
            <button
              key={item}
              disabled={item !== "actual" && !payload.proposal}
              onClick={() => setMode(item)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition disabled:cursor-not-allowed disabled:opacity-30 ${mode === item ? "bg-violet-600 text-white" : "text-white/50 hover:text-white"}`}
            >
              {item === "actual" ? "Actual" : item === "proposal" ? "Propuesta" : <span className="inline-flex items-center gap-1"><Columns2 size={12} /> Comparar</span>}
            </button>
          ))}
        </div>
        <button title="Actualizar desde el draft" onClick={() => void load()} className="rounded-lg border border-white/10 p-2 text-white/55 hover:text-white"><RefreshCw size={14} /></button>
        <Link title="Abrir versión publicada" href={payload.canonicalPath} className="rounded-lg border border-white/10 p-2 text-white/55 hover:text-white"><ExternalLink size={14} /></Link>
      </header>

      {error ? <div className="border-b border-amber-400/20 bg-amber-400/10 px-5 py-2 text-xs text-amber-100">{error}</div> : null}
      {!payload.proposal ? <div className="border-b border-white/10 bg-white/[0.03] px-5 py-2 text-xs text-white/55">Todavía no hay un draft. Creá una nueva versión y elegí una variante para habilitar PROPUESTA.</div> : null}

      {mode === "compare" ? (
        <div className="grid min-h-[calc(100vh-56px)] grid-cols-1 bg-[#111018] xl:grid-cols-2" data-clouva-component="StudioVersionComparison">
          <section className="min-w-0 border-b border-white/10 xl:border-b-0 xl:border-r" data-clouva-version="published">
            <div className="sticky top-14 z-[90] border-b border-emerald-400/15 bg-[#09110f]/95 px-4 py-2 text-xs font-semibold text-emerald-200">ANTERIOR · ACTUAL</div>
            <StudioIdentityRenderer data={payload.current} />
          </section>
          <section className="min-w-0" data-clouva-version="draft">
            <div className="sticky top-14 z-[90] border-b border-violet-400/15 bg-[#100b18]/95 px-4 py-2 text-xs font-semibold text-violet-200">NUEVA PROPUESTA · BORRADOR</div>
            <StudioIdentityRenderer data={visibleProposal} />
          </section>
        </div>
      ) : (
        <section className="min-h-[calc(100vh-56px)]" data-clouva-version={mode === "actual" ? "published" : "draft"} data-clouva-component={mode === "actual" ? "PublishedStudioIdentity" : "DraftStudioIdentity"}>
          <StudioIdentityRenderer data={mode === "actual" ? payload.current : visibleProposal} />
        </section>
      )}
    </main>
  );
}
