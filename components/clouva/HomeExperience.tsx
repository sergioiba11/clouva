"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { HomeDashboard } from "@/components/clouva/HomeDashboard";
import { MobileHomeDashboard } from "@/components/clouva/MobileHomeDashboard";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { PublicLanding } from "@/components/clouva/PublicLanding";

function HomeBoot() {
  return (
    <main
      aria-label="Cargando CLOUVA"
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 50% 42%, rgba(124, 58, 237, 0.12), transparent 28%), #020106",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          minWidth: 72,
          minHeight: 72,
          maxWidth: 72,
          maxHeight: 72,
          overflow: "hidden",
          display: "grid",
          placeItems: "center",
          filter: "drop-shadow(0 0 24px rgba(139, 92, 246, 0.28))",
        }}
      >
        <OfficialClouvaMark
          tone="light"
          alt="CLOUVA"
          width={72}
          height={72}
          style={{ width: 72, height: 72, maxWidth: 72, maxHeight: 72 }}
        />
      </div>
    </main>
  );
}

function initialMobileState(): boolean | null {
  if (typeof window === "undefined") return null;
  return window.matchMedia("(max-width: 820px)").matches;
}

function useMobileHome() {
  const [isMobile, setIsMobile] = useState<boolean | null>(initialMobileState);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const sync = () => setIsMobile(media.matches);

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

export function HomeExperience() {
  const { user, hydrationReady, profileReady } = useAuth();
  const { playerReady } = useCurrentPlayer();
  const isMobile = useMobileHome();

  // Keep both Home implementations statically imported so their CSS modules are
  // part of the initial Home route instead of arriving after the dashboard has
  // already mounted. This avoids the brief unstyled frame visible on slow mobile
  // connections while preserving the same responsive component split.
  if (!hydrationReady) return <HomeBoot />;
  if (!user) return <PublicLanding />;
  if (!profileReady || !playerReady || isMobile === null) return <HomeBoot />;

  return isMobile ? <MobileHomeDashboard /> : <HomeDashboard />;
}
