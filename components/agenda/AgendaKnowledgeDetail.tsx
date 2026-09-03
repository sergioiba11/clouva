"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { GroundedKnowledgePanel } from "@/components/knowledge/GroundedKnowledgePanel";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";

type Topic = "lunar" | "numerologia" | "astrologia";
type Payload = {
  player: { id: string; slug: string; display_name: string };
  profile: PlayerKnowledgeProfile | null;
  derived: { numerologyNumber: number | null; zodiacSign: string | null };
};

export function AgendaKnowledgeDetail({ topic }: { topic: Topic }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/knowledge/me");
        const data = await readApiJson<Payload>(response);
        setPayload(data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar tu conocimiento.");
      }
    })();
  }, []);

  if (error) return <main className="grid min-h-screen place-items-center bg-[#05040a] px-4 text-white"><div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-sm text-red-200">{error}</div></main>;
  if (!payload) return <main className="grid min-h-screen place-items-center bg-[#05040a] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;

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
        <GroundedKnowledgePanel alias={payload.player.slug} topic={topic} heading={heading} value={value} />
      </div>
    </main>
  );
}
