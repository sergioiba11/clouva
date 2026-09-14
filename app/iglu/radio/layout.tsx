import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IgluRadioShell } from "@/components/iglu-radio/IgluRadioShell";
import "./radio.css";

export const metadata: Metadata = {
  title: "IGLÚ RADIO — Del Sur para el mundo",
  description: "IGLÚ RADIO. Digital radio, hip hop, cultura urbana y live sessions dentro del universo IGLÚ.",
  alternates: { canonical: "https://clouva.com.ar/iglu/radio" },
};

export default function IgluRadioLayout({ children }: { children: ReactNode }) {
  return <IgluRadioShell>{children}</IgluRadioShell>;
}
