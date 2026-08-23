import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";

// El escáner, Gemini Vision y Gemini Image comparten el estado canónico de MI SPOT dentro del dashboard.
export default async function StudioCommercePage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  return <SpotCommerceDashboard studioId={studioId} />;
}

