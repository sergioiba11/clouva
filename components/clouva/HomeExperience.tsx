"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
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

    // Start loading the correct dashboard at the same time as auth hydration.
    // This removes the second visual transition after the session resolves.
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
  const { user, hydrationReady } = useAuth();
  const isMobile = useMobileHome();

  // During session hydration we must not render the public landing because a
  // signed-in Player would see the logged-out experience flash on every reload.
  if (!hydrationReady) return <HomeBoot />;
  if (!user) return <PublicLanding />;

  if (isMobile === null) return <HomeBoot />;

  // Mobile y desktop comparten los providers, pero nunca se montan a la vez.
  return isMobile ? <MobileHomeDashboard /> : <HomeDashboard />;
}
