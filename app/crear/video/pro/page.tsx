import type { Metadata } from "next";
import { VideoEnhanceStudio } from "@/components/video-enhance/VideoEnhanceStudio";

export const metadata: Metadata = {
  title: "Video AI Lab | Crear | CLOUVA",
  description: "Transformá videos con LTX en GPU cloud desde CLOUVA.",
};

export default function VideoAiLabPage() {
  return <VideoEnhanceStudio />;
}
