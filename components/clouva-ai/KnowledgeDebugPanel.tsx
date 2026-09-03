"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Brain, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type ContextResult = {
  query: string;
  projectId: string | null;
  requestedScopes: string[];
  core: Array<Record<string, unknown>>;
  memory: Array<Record<string, unknown>>;
  entities: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
  recentEvents: Array<Record<string, unknown>>;
  procedures: Array<Record<string, unknown>>;
  liveData: Record<string, unknown>;
  sourceOfTruth: Record<string, unknown>;
  prompt: string;
};

function names(rows: Array<Record<string, unknown>>, key = "title") {
  return rows
    .map((row) => row[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 8);
}

export function KnowledgeDebugPanel() {
  const [authorized, setAuthorized] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("CLOUVA");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<ContextResult | null>(null);

  useEffect(() => {
    let active = true;
    supabase.rpc("clouva_control_is_admin").then(({ data }) => {
      if (active) setAuthorized(data === true);
    });
    return () => { active = false; };
  }, []);

  const activeProject = useMemo(() => {
    if (!context) return null;
    const project = context.entities.find((entity) => entity.type === "project");
    return typeof project?.title === "string" ? project.title : context.projectId;
  }, [context]);

  if (!authorized) return null;

  async function inspect(event?: FormEvent) {
    event?.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesión no disponible.");
      const response = await fetch("/api/clouva-ai/knowledge/context", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: normalized }),
      });
      const payload = (await response.json()) as { error?: string; context?: ContextResult };
      if (!response.ok || !payload.context) throw new Error(payload.error ?? "No se pudo recuperar el contexto.");
      setContext(payload.context);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo recuperar el contexto.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-3 top-16 z-[70] inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-black/80 px-3 py-2 text-xs font-medium text-violet-100 shadow-lg backdrop-blur"
        aria-label="Inspeccionar conocimiento de CLOUVA AI"
      >
        <Brain className="h-4 w-4" />
        Conocimiento
      </button>
    );
  }

  return (
    <aside className="fixed right-3 top-16 z-[70] flex max-h-[72dvh] w-[min(92vw,390px)] flex-col overflow-hidden rounded-2xl border border-violet-400/25 bg-zinc-950/95 text-zinc-100 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Brain className="h-4 w-4" /> Contexto usado</div>
          <p className="mt-0.5 text-[11px] text-zinc-400">Admin · retrieval real, sin debug para Players</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={inspect} className="flex gap-2 border-b border-white/10 p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="pica del Iglú, publicar producto..."
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-violet-400/50"
        />
        <button type="submit" disabled={loading} className="rounded-xl bg-violet-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </form>

      <div className="overflow-y-auto p-4 text-xs">
        {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-red-200">{error}</p> : null}
        {!context && !error ? <p className="text-zinc-400">Buscá una referencia para ver exactamente qué recupera CLOUVA AI.</p> : null}
        {context ? (
          <div className="space-y-4">
            <section className="rounded-xl bg-white/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Proyecto activo</p>
              <p className="mt-1 text-sm text-white">{activeProject ?? "No resuelto"}</p>
              {context.prompt ? <p className="mt-2 leading-relaxed text-zinc-300">{context.prompt}</p> : null}
            </section>

            {[
              ["Entidades", names(context.entities)],
              ["Memorias", names(context.memory)],
              ["Procedimientos", names(context.procedures)],
              ["CLOUVA Core", names(context.core)],
            ].map(([label, values]) => (
              <section key={label as string}>
                <div className="mb-1 flex items-center justify-between text-zinc-400">
                  <span>{label as string}</span><span>{(values as string[]).length}</span>
                </div>
                <p className="leading-relaxed text-zinc-200">{(values as string[]).join(" · ") || "—"}</p>
              </section>
            ))}

            <section>
              <div className="mb-1 flex items-center justify-between text-zinc-400"><span>Relaciones</span><span>{context.relations.length}</span></div>
              <div className="space-y-1 text-zinc-200">
                {context.relations.slice(0, 8).map((relation, index) => (
                  <p key={String(relation.id ?? index)}>
                    {String(relation.sourceTitle ?? "?")} → {String(relation.relation ?? "related_to")} → {String(relation.targetTitle ?? "?")}
                  </p>
                ))}
                {!context.relations.length ? <p>—</p> : null}
              </div>
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between text-zinc-400"><span>Eventos recientes</span><span>{context.recentEvents.length}</span></div>
              <p className="leading-relaxed text-zinc-200">{context.recentEvents.slice(0, 5).map((row) => String(row.summary ?? row.event_type ?? "evento")).join(" · ") || "—"}</p>
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between text-zinc-400"><span>Live Data</span><span>{Object.keys(context.liveData).length}</span></div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[10px] leading-relaxed text-zinc-300">{Object.keys(context.liveData).length ? JSON.stringify(context.liveData, null, 2) : "No consultado para esta referencia."}</pre>
            </section>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
