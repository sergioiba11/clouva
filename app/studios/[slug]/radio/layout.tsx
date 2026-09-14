import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { IgluRadioShell } from "@/components/iglu-radio/IgluRadioShell";
import { IGLU_RADIO_PATH, IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import "../../../iglu/radio/radio.css";

export const metadata: Metadata = {
  title: "IGLÚ RADIO — El Iglú",
  description: "La radio oficial de El Iglú dentro de CLOUVA: música, cultura urbana, sesiones y transmisión en vivo.",
  alternates: { canonical: `https://clouva.com.ar${IGLU_RADIO_PATH}` },
};

export default async function IgluStudioRadioLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  return <IgluRadioShell>{children}</IgluRadioShell>;
}
