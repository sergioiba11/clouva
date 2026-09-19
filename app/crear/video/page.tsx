import type { Metadata } from "next";
import { VideoProjectCreator } from "@/components/video-engine/VideoProjectCreator";

export const metadata: Metadata = {
  title: "Video Cloud | Crear | CLOUVA",
  description: "Creá proyectos de video en cloud con CLOUVA.",
};

export default function CrearVideoPage() {
  return <VideoProjectCreator />;
}
