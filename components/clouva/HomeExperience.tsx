"use client";

import dynamic from "next/dynamic";
import { useAuth } from "@/components/auth-provider";

const HomeDashboard = dynamic(() => import("@/components/clouva/HomeDashboard").then((mod) => mod.HomeDashboard), {
  ssr: false,
  loading: () => <main className="min-h-screen bg-[#060612]" aria-hidden="true" />,
});

const PublicLanding = dynamic(() => import("@/components/clouva/PublicLanding").then((mod) => mod.PublicLanding), {
  ssr: false,
  loading: () => <main className="min-h-screen bg-[#07060b]" aria-hidden="true" />,
});

export function HomeExperience() {
  const { user, loading, hydrationReady } = useAuth();

  // Antes de saber si hay sesión, no se puede elegir entre dashboard y
  // landing sin arriesgar un parpadeo del contenido equivocado.
  if (loading || !hydrationReady) {
    return <main className="min-h-screen bg-[#07060b]" aria-hidden="true" />;
  }

  return user ? <HomeDashboard /> : <PublicLanding />;
}
