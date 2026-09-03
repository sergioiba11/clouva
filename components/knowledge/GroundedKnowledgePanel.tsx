"use client";

import { ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
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

export function GroundedKnowledgePanel({ alias, topic, heading, value }: { alias: string; topic: "lunar" | "numerologia" | "astrologia"; heading: string; value?: string | null }) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/insight?alias=${encodeURIComponent(alias)}&topic=${encodeURIComponent(topic)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as Insight & { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo cargar la data.");
      setInsight(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la data.");
    } finally {
      setLoading(false);
    }
  }, [alias, topic]);

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
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-violet-200"><Sparkles size={14} /> Síntesis de CLOUVA AI</div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-white/70">{insight.content}</div>
          </div>

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
