"use client";

import type { ReactNode } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { CurrentPlayerProvider } from "@/components/current-player-provider";
import { ActiveAvatarHydrator } from "@/components/avatar-engine/ActiveAvatarHydrator";
import { GlobalSpotifyPlayer } from "@/components/GlobalSpotifyPlayer";
import { GlobalClouvaAIButtonGate } from "@/components/GlobalClouvaAIButtonGate";
import { ClouvaSystemTopBarGate } from "@/components/clouva/system/ClouvaSystemTopBarGate";
import { ClouvaAIAssistantProvider } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { SpotifyPlaybackProvider } from "@/components/music/SpotifyPlaybackProvider";
import { PlayerBasicsGate } from "@/components/onboarding/PlayerBasicsGate";

const LIGHTWEIGHT_PREFIXES = [
  "/login",
  "/registro",
  "/auth",
  "/debug-auth",
  "/onboarding/player-basics",
] as const;

function isLightweightRoute(pathname: string) {
  return LIGHTWEIGHT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function ClouvaAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isLightweightRoute(pathname)) return children;

  return (
    <>
      <Script
        id="clouva-model-viewer"
        type="module"
        src="https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js"
        strategy="afterInteractive"
      />
      <CurrentPlayerProvider>
        <PlayerBasicsGate>
          <SpotifyPlaybackProvider>
            <ClouvaAIAssistantProvider>
              <ActiveAvatarHydrator />
              <ClouvaSystemTopBarGate />
              {children}
              <GlobalClouvaAIButtonGate />
              <GlobalSpotifyPlayer />
            </ClouvaAIAssistantProvider>
          </SpotifyPlaybackProvider>
        </PlayerBasicsGate>
      </CurrentPlayerProvider>
    </>
  );
}
