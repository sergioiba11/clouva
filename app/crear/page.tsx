import type { Metadata } from "next";
import { MediaCreatorPage } from "@/components/media-creator/MediaCreatorPage";

export const metadata: Metadata = {
  title: "Crear | CLOUVA",
  description: "Generá imágenes y videos con CLOUVA.",
};

export default function CrearPage() {
  return <MediaCreatorPage />;
}
