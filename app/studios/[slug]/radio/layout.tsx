import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IGLU_RADIO_PATH } from "@/lib/iglu-radio/routes";

export const metadata: Metadata = {
  title: "IGLÚ RADIO — IGLÚ RECORDS",
  alternates: { canonical: `https://clouva.com.ar${IGLU_RADIO_PATH}` },
  robots: { index: false, follow: true },
};

export default function LegacyIgluStudioRadioLayout({ children }: { children: ReactNode }) {
  return children;
}
