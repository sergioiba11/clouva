import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { IgluSiteShell } from "@/components/iglu/IgluSiteShell";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
import "./iglu-site.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "IGLÚ Records — Del Sur para el mundo", template: "%s — IGLÚ Records" },
  description: "IGLÚ Records: estudio, artistas, radio, sesiones, producción, cultura y comunidad. Del Sur para el mundo.",
};

export default async function IgluSiteLayout({ children }: { children: ReactNode }) {
  const data = await loadIgluSiteData();
  if (!data) notFound();
  return <IgluSiteShell logoUrl={data.assets.logo} emblemUrl={data.assets.emblem}>{children}</IgluSiteShell>;
}
