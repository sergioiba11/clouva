"use client";

import { ExternalLink, ImageIcon, Loader2, RefreshCw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useState } from "react";

type Insight = {
  topic: "lunar" | "numerologia" | "astrologia";
  title: string;
  content: string;
  sources: Array<{ title: string; url: string }>;
  model: string | null;
  generatedAt: string;
  cached: boolean;
  grounded: boolean;
};

function RichKnowledgeMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h2 className="mb-3 mt-7 text-xl font-black tracking-tight text-white first:mt-0">{children}</h2>,
        h2: ({ children }) => <h2 className="mb-3 mt-7 text-lg font-black tracking-tight text-white first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-6 text-base font-bold text-violet-100 first:mt-0">{children}</h3>,
        p: ({ children }) => <p className="my-3 text-sm leading-7 text-white/72">{children}</p>,
        strong: ({ children }) => <strong className="font-bold text-white/95">{children}</strong>,
        em: ({ children }) => <em className="text-white/75">{children}</em>,
        ul: ({ children }) => <ul className="my-4 space-y-2 pl-5 text-sm leading-7 text-white/72">{children}</ul>,
        ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-5 text-sm leading-7 text-white/72">{children}</ol>,
        li: ({ children }) => <li className="list-disc pl-1 marker:text-violet-300">{children}</li>,
        blockquote: ({ children }) => <blockquote className="my-5 rounded-r-xl border-l-2 border-violet-400/45 bg-violet-500/[0.06] px-4 py-2 text-white/70">{children}</blockquote>,
        hr: () => <hr className="my-6 border-white/10" />,
        table: ({ children }) => (
          <div className="my-5 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[520px] border-collapse text-left text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-white/[0.05] text-white/85">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y divide-white/[0.07]">{children}</tbody>,
        th: ({ children }) => <th className="px-3 py-2.5 font-bold">{children}</th>,
        td: ({ children }) => <td className="px-3 py-2.5 align-top leading-5 text-white/60">{children}</td>,
        code: ({ children }) => <code className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[0.9em] text-violet-100">{children}</code>,
        a: ({ href, children }) => {
          const safe = typeof href === "string" && /^https?:\/\//i.test(href) ? href : undefined;
          return safe ? <a href={safe} target="_blank" rel="noopener noreferrer" className="font-medium text-violet-300 underline decoration-violet-400/30 underline-offset-2 hover:text-violet-200">{children}</a> : <span>{children}</span>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function GroundedKnowledgePanel({ alias, topic, heading, value }: { alias: string; topic: "lunar" | "numerologia" | "astrologia"; heading: string; value?: string | null }) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visualUrl, setVisualUrl] = useState<string | null>(null);
  const [visualLoading, setVisualLoading] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/insight?alias=${encodeURIComponent(alias)}&topic=${encodeURIComponent(topic)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as Insight & { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo cargar la data.");
      setInsight(body);
      setVisualUrl(null);
      setVisualError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la data.");
    } finally {
      setLoading(false);
    }
  }, [alias, topic]);

  const generateVisual = useCallback(async () => {
    if (!insight || visualLoading) return;
    setVisualLoading(true);
    setVisualError(null);
    try {
      const response = await fetch("/api/knowledge/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias,
          topic,
          heading,
          value: value ?? null,
          context: insight.content.slice(0, 4_000),
        }),
      });
      const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Gemini no pudo crear el visual.");
      setVisualUrl(body.url);
    } catch (visualLoadError) {
      setVisualError(visualLoadError instanceof Error ? visualLoadError.message : "Gemini no pudo crear el visual.");
    } finally {
      setVisualLoading(false);
    }
  }, [alias, heading, insight, topic, value, visualLoading]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="rounded-[2rem] border border-violet-300/15 bg-[radial-gradient(circle_at_85%_5%,rgba(139,92,246,.18),transparent_34%),#0b0913] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300/70">CLOUVA AI · DATA FUNDAMENTADA</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{heading}</h1>
          {value ? <p className="mt-2 text-5xl font-black text-violet-200">{value}</p> : null}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-white/55 transition hover:text-white disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Actualizar</button>
      </div>

      {loading ? (
        <div className="mt-8 flex min-h-48 items-center justify-center gap-3 text-sm text-white/45"><Loader2 size={18} className="animate-spin text-violet-300" /> Buscando y verificando fuentes…</div>
      ) : error ? (
        <div className="mt-7 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      ) : insight ? (
        <>
          <div className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-200"><Sparkles size={14} /> Síntesis de CLOUVA AI</div>
              <button
                type="button"
                onClick={() => void generateVisual()}
                disabled={visualLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-violet-300/15 bg-violet-500/[0.07] px-3 py-1.5 text-[11px] font-semibold text-violet-100 transition hover:border-violet-300/35 hover:bg-violet-500/[0.12] disabled:opacity-50"
              >
                {visualLoading ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
                {visualUrl ? "Regenerar visual" : "Visual con Gemini"}
              </button>
            </div>
            <RichKnowledgeMarkdown content={insight.content} />
          </div>

          {visualUrl ? (
            <figure className="mt-5 overflow-hidden rounded-2xl border border-violet-300/15 bg-black/25">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={visualUrl} alt={`Explicación visual de ${heading} generada por Gemini`} className="block h-auto w-full" />
              <figcaption className="border-t border-white/10 px-4 py-3 text-[11px] leading-5 text-white/40">Visual educativo generado por Gemini. No sustituye los datos verificables ni las fuentes consultadas.</figcaption>
            </figure>
          ) : null}
          {visualError ? <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-4 py-3 text-xs text-amber-100/75">{visualError}</div> : null}

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">Fuentes consultadas</p>
              <span className="text-[10px] text-white/25">{insight.cached ? "cache verificado" : "búsqueda nueva"}</span>
            </div>
            {insight.sources.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {insight.sources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs text-white/55 transition hover:border-violet-400/35 hover:text-white">
                    <span className="truncate">{source.title}</span><ExternalLink size={13} className="shrink-0 text-violet-300" />
                  </a>
                ))}
              </div>
            ) : <p className="mt-3 text-xs text-white/35">La respuesta fue fundamentada, pero el proveedor no devolvió enlaces visibles para esta consulta.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
