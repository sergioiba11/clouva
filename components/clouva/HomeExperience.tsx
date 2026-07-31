"use client";

import dynamic from "next/dynamic";

const HomeDashboard = dynamic(() => import("@/components/clouva/HomeDashboard").then((mod) => mod.HomeDashboard), {
  ssr: false,
  loading: () => <main className="min-h-screen bg-[#060612]" aria-hidden="true" />,
});

export function HomeExperience() {
  return <HomeDashboard />;
}
