"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PersistentAudioEngine } from "@/components/radio/PersistentAudioEngine";
import { PersistentRadioPlayer } from "@/components/radio/PersistentRadioPlayer";
import { RadioProvider } from "@/components/radio/RadioProvider";
import type { RadioStationConfig } from "@/lib/radio/types";

export function ProfileRadioShell({ children, station }: { children: ReactNode; station: RadioStationConfig }) {
  return (
    <RadioProvider station={station}>
      <div className="iglu-radio-root">
        <div className="iglu-radio-atmosphere" aria-hidden="true">
          <div className="iglu-radio-glow iglu-radio-glow--one" />
          <div className="iglu-radio-glow iglu-radio-glow--two" />
          <div className="iglu-radio-stars" />
          <div className="iglu-radio-skyline" />
          <div className="iglu-radio-ice-floor" />
        </div>

        <header className="iglu-radio-header">
          <div className="iglu-radio-header__inner">
            <Link href={`/${station.alias}/radio`} className="iglu-radio-brand" aria-label={`${station.name} Radio`}>
              <span className="iglu-radio-brand__iglu">{station.name}</span>
              <span className="iglu-radio-brand__radio">RADIO</span>
              {station.tagline ? <span className="iglu-radio-brand__tagline">{station.tagline}</span> : null}
            </Link>
            <div className="iglu-radio-header__actions">
              <Link
                href={station.profileHref}
                className="min-h-10 inline-flex items-center rounded-full border border-cyan-100/15 bg-black/20 px-3 text-[9px] font-bold tracking-[0.16em] text-cyan-50/70 transition hover:border-cyan-100/35 hover:text-white"
              >
                VER PERFIL
              </Link>
            </div>
          </div>
        </header>

        <main className="iglu-radio-content">{children}</main>
        <PersistentAudioEngine />
        <PersistentRadioPlayer />
      </div>
    </RadioProvider>
  );
}
