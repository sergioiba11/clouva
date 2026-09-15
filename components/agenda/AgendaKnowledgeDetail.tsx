"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { GroundedKnowledgePanel } from "@/components/knowledge/GroundedKnowledgePanel";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";

type Topic = "lunar" | "numerologia" | "astrologia";
type Insight = {
  topic: Topic;
  title: string;
  content: string | null;
  sources: Array<{ title: string; url: string }>;
  model: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  cached: boolean;
  stale: boolean;
  refreshing: boolean;
  grounded: boolean;
  state: "fresh" | "stale" | "empty";
};
type Payload = {
  player: { id: string; slug: string; display_name: string };
  profile: PlayerKnowledgeProfile | null;
  derived: { numerologyNumber: number | null; zodiacSign: string | null };
  insight?: Insight | null;
};

function DetailSkeleton({ topic }: { topic: Topic }) {
  const heading = topic === "lunar" ? "Data de la Luna" : topic === "numerologia" ? "Numerología" : "Astrología";
  const value = topic === "lunar" ? "Luna" : null;
  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Link href="/agenda#luna" className="mb-5 inline-flex items-center gap-2 text-sm text-white/45 transition hover:text-white"><ArrowLeft size={16} /> Volver a Agenda</Link>
        <section className="rounded-[2rem] border border-violet-300/15 bg-[radial-gradient(circle_at_85%_5%,rgba(139,92,246,.18),transparent_34%),#0b0913] p-5 sm:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300/70">CLOUVA AI · DATA FUNDAMENTADA</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{heading}</h1>
          {value ? <p className="mt-2 text-5xl font-black text-violet-200">{value}</p> : null}
          <div className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-xs text-white/45"><Loader2 size={14} className="animate-spin text-violet-300" /> Preparando información actual…</div>
            <div className="mt-5 space-y-3">
              <div className="h-3 w-4/5 animate-pulse rounded-full bg-white/[0.07]" />
              <div className="h-3 w-full animate-pulse rounded-full bg-white/[0.06]" />
              <div className="h-3 w-3/4 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="h-3 w-5/6 animate-pulse rounded-full bg-white/[0.05]" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export function AgendaKnowledgeDetail({ topic }: { topic: Topic }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await authenticatedFetch(`/api/knowledge/me?topic=${encodeURIComponent(topic)}`);
        const data = await readApiJson<Payload>(response);
        setPayload(data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar tu conocimiento.");
      }
    })();
  }, [topic]);

  if (error) return <main className="grid min-h-screen place-items-center bg-[#05040a] px-4 text-white"><div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-sm text-red-200">{error}</div></main>;
  if (!payload) return <DetailSkeleton topic={topic} />;

  const number = payload.profile?.show_numerology ? payload.derived.numerologyNumber : null;
  const sign = payload.profile?.show_zodiac ? payload.derived.zodiacSign : null;
  const enabled = topic === "lunar" ? Boolean(payload.profile?.show_lunar)
    : topic === "numerologia" ? number !== null
    : Boolean(sign);
  if (!enabled) {
    return (
      <main className="min-h-screen bg-[#05040a] px-4 py-8 text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/[0.025] p-6 text-center">
          <p className="text-sm text-white/50">Este conocimiento no está activado en tu Player.</p>
          <Link href="/profile/knowledge" className="mt-4 inline-flex rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold">Configurar Conocimiento</Link>
        </div>
      </main>
    );
  }

  const heading = topic === "lunar" ? "Data de la Luna" : topic === "numerologia" ? "Numerología" : "Astrología";
  const value = topic === "lunar" ? "Luna" : topic === "numerologia" ? String(number) : sign;
  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Link href="/agenda#luna" className="mb-5 inline-flex items-center gap-2 text-sm text-white/45 transition hover:text-white"><ArrowLeft size={16} /> Volver a Agenda</Link>
        <GroundedKnowledgePanel
          alias={payload.player.slug}
          topic={topic}
          heading={heading}
          value={value}
          initialInsight={payload.insight ?? null}
        />
      </div>
    </main>
  );
}
