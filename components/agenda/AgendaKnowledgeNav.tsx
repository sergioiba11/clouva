"use client";

import Link from "next/link";
import { MoonStar } from "lucide-react";
import { useEffect, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";

type Payload = {
  profile: PlayerKnowledgeProfile | null;
  derived: { numerologyNumber: number | null; zodiacSign: string | null };
};

const ITEM = "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-white/65 transition hover:bg-white/[0.07] hover:text-white";

export function AgendaKnowledgeNav() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/knowledge/me");
        if (!response.ok) return;
        const payload = await readApiJson<Payload>(response);
        if (!cancelled) setData(payload);
      } catch {
        // Agenda remains usable even when the optional knowledge profile is unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex items-center rounded-xl border border-violet-300/10 bg-violet-500/[0.045] p-0.5">
      <Link href="/agenda/lunar" className={ITEM} title="Data de la Luna"><MoonStar size={14} /><span className="hidden sm:inline">Luna</span></Link>
      {data?.profile?.show_numerology && data.derived.numerologyNumber !== null ? (
        <Link href="/agenda/conocimiento/numerologia" className={`${ITEM} min-w-8 justify-center text-violet-200`} title={`Numerología: ${data.derived.numerologyNumber}`}>{data.derived.numerologyNumber}</Link>
      ) : null}
      {data?.profile?.show_zodiac && data.derived.zodiacSign ? (
        <Link href="/agenda/conocimiento/astrologia" className={`${ITEM} text-violet-100`} title={`Signo: ${data.derived.zodiacSign}`}><span aria-hidden="true">♎</span><span className="hidden md:inline">{data.derived.zodiacSign}</span></Link>
      ) : null}
    </div>
  );
}
