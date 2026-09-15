"use client";

import type { ReactNode } from "react";
import { PersistentAudioEngine } from "@/components/iglu-radio/PersistentAudioEngine";
import { PersistentRadioPlayer } from "@/components/iglu-radio/PersistentRadioPlayer";
import { RadioHeader } from "@/components/iglu-radio/RadioHeader";
import { RadioProvider } from "@/components/iglu-radio/RadioProvider";
import type { RadioStationConfig } from "@/lib/radio/types";

export function IgluRadioShell({ children, station }: { children: ReactNode; station?: RadioStationConfig }) {
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
        <RadioHeader />
        <main className="iglu-radio-content">{children}</main>
        <PersistentAudioEngine />
        <PersistentRadioPlayer />
      </div>
    </RadioProvider>
  );
}
