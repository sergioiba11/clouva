import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { IgluRadioShell } from "@/components/iglu-radio/IgluRadioShell";
import { IGLU_RADIO_PATH, IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { resolvePublicProfileRadio } from "@/lib/server/profile-radio-data";
import "../../../../iglu/radio/radio.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IGLÚ RADIO — IGLÚ RECORDS",
  description: "La radio oficial de IGLÚ RECORDS dentro de CLOUVA: música, cultura urbana, sesiones y transmisión en vivo.",
  alternates: { canonical: `https://clouva.com.ar${IGLU_RADIO_PATH}` },
  robots: { index: true, follow: true },
};

export default async function MatrixIgluRadioLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const studio = await resolveStudioAlias(slug);
  if (!studio || studio.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  const configuredStation = await resolvePublicProfileRadio(IGLU_STUDIO_SLUG);
  if (!configuredStation) notFound();
  const station = { ...configuredStation, alias: studio.canonicalAlias };
  return <IgluRadioShell station={station}>{children}</IgluRadioShell>;
}
