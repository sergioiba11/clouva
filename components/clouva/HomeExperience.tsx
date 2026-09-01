"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PublicLanding } from "@/components/clouva/PublicLanding";

const HomeDashboard = dynamic(() => import("@/components/clouva/HomeDashboard").then((mod) => mod.HomeDashboard), {
  ssr: false,
  loading: () => <PublicLanding />,
});

const MobileHomeDashboard = dynamic(
  () => import("@/components/clouva/MobileHomeDashboard").then((mod) => mod.MobileHomeDashboard),
  {
    ssr: false,
    loading: () => <PublicLanding />,
  },
);

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
  const { user, hydrationReady } = useAuth();
  const isMobile = useMobileHome();

  // Render real content immediately. Auth/profile resolution continues in the
  // background; when a session is confirmed we replace this shell with the
  // correct dashboard instead of holding the first paint behind Supabase.
  if (!hydrationReady) return <PublicLanding />;
  if (!user) return <PublicLanding />;

  // matchMedia normally resolves before auth on the client. If it has not yet,
  // keep meaningful content visible rather than flashing an empty screen.
  if (isMobile === null) return <PublicLanding />;

  // Mobile y desktop comparten los providers, pero nunca se montan a la vez.
  // Esto evita cargar la composición desktop detrás de la Home mobile.
  return isMobile ? <MobileHomeDashboard /> : <HomeDashboard />;
}
