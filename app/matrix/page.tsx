import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = {
  title: "La Matrix | CLOUVA",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://clouva.com.ar/lamatrix" },
};

export default function LegacyMatrixPage() {
  permanentRedirect("/lamatrix");
}
