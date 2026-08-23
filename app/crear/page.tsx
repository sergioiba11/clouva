import type { Metadata } from "next";
import { Suspense } from "react";
import { MediaCreatorPage } from "@/components/media-creator/MediaCreatorPage";

export const metadata: Metadata = {
  title: "Crear | CLOUVA",
  description: "Generá imágenes y videos con CLOUVA.",
};

export default function CrearPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#05030a] text-white" />}>
      <MediaCreatorPage />
    </Suspense>
  );
}
