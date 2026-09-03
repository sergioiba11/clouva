"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";

type Payload = {
  profile: PlayerKnowledgeProfile | null;
  derived: { numerologyNumber: number | null; zodiacSign: string | null };
};

function zodiacSymbol(sign: string) {
  const symbols: Record<string, string> = {
    Aries: "♈", Tauro: "♉", Géminis: "♊", Cáncer: "♋", Leo: "♌", Virgo: "♍",
    Libra: "♎", Escorpio: "♏", Sagitario: "♐", Capricornio: "♑", Acuario: "♒", Piscis: "♓",
  };
  return symbols[sign] || "✦";
}

export function AgendaKnowledgeCardDock() {
  const pathname = usePathname();
  const router = useRouter();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    setTarget(null);
    if (pathname !== "/agenda") return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    const resolveTarget = () => {
      const section = document.getElementById("luna");
      if (!section || cancelled) return false;
      setTarget(section);
      observer?.disconnect();
      return true;
    };

    if (!resolveTarget()) {
      observer = new MutationObserver(() => { void resolveTarget(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/knowledge/me");
        if (!response.ok) return;
        const payload = await readApiJson<Payload>(response);
        if (!cancelled) setData(payload);
      } catch {
        // Knowledge is optional; the lunar card itself remains fully usable.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!target) return;
    const previousCursor = target.style.cursor;
    const previousRole = target.getAttribute("role");
    const previousTabIndex = target.getAttribute("tabindex");
    const previousLabel = target.getAttribute("aria-label");
    target.style.cursor = "pointer";
    target.setAttribute("role", "link");
    target.setAttribute("tabindex", "0");
    target.setAttribute("aria-label", "Abrir data de la Luna");

    const isInteractiveTarget = (event: Event) => {
      const element = event.target as Element | null;
      return Boolean(element?.closest("a,button,input,select,textarea,[data-knowledge-action]"));
    };
    const openLunar = (event: Event) => {
      if (isInteractiveTarget(event)) return;
      router.push("/agenda/conocimiento/lunar");
    };
    const onKey = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event)) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      router.push("/agenda/conocimiento/lunar");
    };
    target.addEventListener("click", openLunar);
    target.addEventListener("keydown", onKey);
    return () => {
      target.removeEventListener("click", openLunar);
      target.removeEventListener("keydown", onKey);
      target.style.cursor = previousCursor;
      if (previousRole === null) target.removeAttribute("role"); else target.setAttribute("role", previousRole);
      if (previousTabIndex === null) target.removeAttribute("tabindex"); else target.setAttribute("tabindex", previousTabIndex);
      if (previousLabel === null) target.removeAttribute("aria-label"); else target.setAttribute("aria-label", previousLabel);
    };
  }, [router, target]);

  if (!target) return null;
  const number = data?.profile?.show_numerology ? data.derived.numerologyNumber : null;
  const sign = data?.profile?.show_zodiac ? data.derived.zodiacSign : null;

  return createPortal(
    <div data-knowledge-action className="absolute right-3 top-3 z-20 flex items-center gap-1.5 sm:right-4 sm:top-4">
      {number !== null ? (
        <Link
          href="/agenda/conocimiento/numerologia"
          title={`Numerología · Número ${number}`}
          className="grid h-9 min-w-9 place-items-center rounded-xl border border-violet-300/20 bg-[#0b0913]/85 px-2 text-sm font-black text-violet-100 shadow-lg backdrop-blur transition hover:border-violet-300/45 hover:bg-violet-500/15"
        >
          {number}
        </Link>
      ) : null}
      {sign ? (
        <Link
          href="/agenda/conocimiento/astrologia"
          title={`Astrología · ${sign}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-violet-300/20 bg-[#0b0913]/85 px-2.5 text-xs font-semibold text-violet-100 shadow-lg backdrop-blur transition hover:border-violet-300/45 hover:bg-violet-500/15"
        >
          <span aria-hidden="true" className="text-base">{zodiacSymbol(sign)}</span>
          <span className="hidden sm:inline">{sign}</span>
        </Link>
      ) : null}
    </div>,
    target,
  );
}
