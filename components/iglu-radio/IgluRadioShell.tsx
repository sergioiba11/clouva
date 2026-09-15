"use client";

import type { ReactNode } from "react";
import { PersistentAudioEngine } from "@/components/iglu-radio/PersistentAudioEngine";
import { PersistentRadioPlayer } from "@/components/iglu-radio/PersistentRadioPlayer";
import { RadioHeader } from "@/components/iglu-radio/RadioHeader";
import { RadioLiveData } from "@/components/iglu-radio/RadioLiveData";
import { RadioProvider } from "@/components/iglu-radio/RadioProvider";

export function IgluRadioShell({ children }: { children: ReactNode }) {
  return (
    <RadioProvider>
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
        <RadioLiveData />
        <PersistentAudioEngine />
        <PersistentRadioPlayer />
      </div>
    </RadioProvider>
  );
}
