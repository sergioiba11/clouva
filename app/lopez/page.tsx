import type { Metadata } from "next";
import { LopezDemo } from "./LopezDemo";

export const metadata: Metadata = {
  title: "López — Prototipo de gestión de salud | CLOUVA",
  description: "Prototipo independiente de experiencia para afiliados, trámites y trazabilidad.",
  robots: { index: false, follow: false },
};

export default function LopezPage() {
  return <LopezDemo />;
}
