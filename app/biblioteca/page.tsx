import type { Metadata } from "next";
import { ClouvaLibrary } from "@/components/library/ClouvaLibrary";

export const metadata: Metadata = {
  title: "Biblioteca | CLOUVA",
  description: "Tus modelos 3D, imágenes, sonidos y videos en un mismo lugar.",
};

export default function BibliotecaPage() {
  return <ClouvaLibrary />;
}
