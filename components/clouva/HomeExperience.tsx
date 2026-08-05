"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";

const HomeDashboard = dynamic(() => import("@/components/clouva/HomeDashboard").then((mod) => mod.HomeDashboard), {
  ssr: false,
  loading: () => <main className="min-h-screen bg-[#060612]" aria-hidden="true" />,
});

const MobileHomeDashboard = dynamic(
  () => import("@/components/clouva/MobileHomeDashboard").then((mod) => mod.MobileHomeDashboard),
  {
    ssr: false,
    loading: () => <main className="min-h-screen bg-[#030308]" aria-hidden="true" />,
  },
);

const PublicLanding = dynamic(() => import("@/components/clouva/PublicLanding").then((mod) => mod.PublicLanding), {
  ssr: false,
  loading: () => <main className="min-h-screen bg-[#07060b]" aria-hidden="true" />,
});

function useMobileHome() {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

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
  const { user, loading, hydrationReady } = useAuth();
  const isMobile = useMobileHome();

  // Antes de saber si hay sesión, no se puede elegir entre dashboard y
  // landing sin arriesgar un parpadeo del contenido equivocado.
  if (loading || !hydrationReady) {
    return <main className="min-h-screen bg-[#07060b]" aria-hidden="true" />;
  }

  if (!user) return <PublicLanding />;
  if (isMobile === null) return <main className="min-h-screen bg-[#030308]" aria-hidden="true" />;

  // Mobile y desktop comparten los providers, pero nunca se montan a la vez.
  // Esto evita cargar la composición desktop detrás de la nueva Home mobile.
  return isMobile ? <MobileHomeDashboard /> : <HomeDashboard />;
}
