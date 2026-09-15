import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { IgluRadioShell } from "@/components/iglu-radio/IgluRadioShell";
import { resolvePublicProfileRadio } from "@/lib/server/profile-radio-data";
import "./radio.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IGLÚ RADIO — Del Sur para el mundo",
  description: "IGLÚ RADIO. Digital radio, hip hop, cultura urbana y live sessions dentro del universo IGLÚ.",
  alternates: { canonical: "https://clouva.com.ar/iglu/radio" },
};

export default async function IgluRadioLayout({ children }: { children: ReactNode }) {
  const configuredStation = await resolvePublicProfileRadio("el-iglu");
  if (!configuredStation) notFound();

  const station = { ...configuredStation, alias: "iglu" };
  return <IgluRadioShell station={station}>{children}</IgluRadioShell>;
}
