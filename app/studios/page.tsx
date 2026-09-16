import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Estudios — La Matrix | CLOUVA",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://clouva.com.ar/lamatrix/estudios" },
};

export default function LegacyStudiosDirectoryPage() {
  permanentRedirect("/lamatrix/estudios");
}
