"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { ClouvaBoot } from "@/components/clouva/ClouvaBoot";
import { HomeDashboard } from "@/components/clouva/HomeDashboard";
import { MobileHomeDashboard } from "@/components/clouva/MobileHomeDashboard";
import { PublicLanding } from "@/components/clouva/PublicLanding";

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
  if (!hydrationReady) return <ClouvaBoot subtitle="Abriendo CLOUVA..." />;
  if (!user) return <PublicLanding />;
  if (!profileReady || !playerReady || isMobile === null) return <ClouvaBoot subtitle="Preparando tu universo..." />;

  return isMobile ? <MobileHomeDashboard /> : <HomeDashboard />;
}
