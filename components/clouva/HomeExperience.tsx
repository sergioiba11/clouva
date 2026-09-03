"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
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
        background:
          "radial-gradient(circle at 50% 42%, rgba(124, 58, 237, 0.12), transparent 28%), #020106",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          display: "grid",
          placeItems: "center",
          filter: "drop-shadow(0 0 24px rgba(139, 92, 246, 0.28))",
        }}
      >
        <OfficialClouvaMark className="h-full w-full" tone="light" alt="CLOUVA" />
      </div>
    </main>
  );
}

const HomeDashboard = dynamic(() => import("@/components/clouva/HomeDashboard").then((mod) => mod.HomeDashboard), {
  ssr: false,
  loading: () => <HomeBoot />,
});

const MobileHomeDashboard = dynamic(
  () => import("@/components/clouva/MobileHomeDashboard").then((mod) => mod.MobileHomeDashboard),
  {
    ssr: false,
    loading: () => <HomeBoot />,
  },
);

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

    if (media.matches) {
      void import("@/components/clouva/MobileHomeDashboard");
    } else {
      void import("@/components/clouva/HomeDashboard");
    }

    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

export function HomeExperience() {
  const { user, hydrationReady, profileReady } = useAuth();
  const { playerReady } = useCurrentPlayer();
  const isMobile = useMobileHome();

  // Do not mount the personalized Home until auth, profile and Player identity
  // are all stable. This prevents the reload sequence from briefly rendering
  // account fallbacks (for example a letter avatar/name) before the real Player.
  if (!hydrationReady) return <HomeBoot />;
  if (!user) return <PublicLanding />;
  if (!profileReady || !playerReady || isMobile === null) return <HomeBoot />;

  return isMobile ? <MobileHomeDashboard /> : <HomeDashboard />;
}
