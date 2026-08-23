import { ClouvaQrEnginePanel } from "@/components/commerce/ClouvaQrEnginePanel";
import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";

// El escáner, Gemini Vision, Gemini Image y QR CLOUVA comparten el estado
// canónico de MI SPOT dentro del mismo workspace comercial.
export default async function StudioCommercePage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  return (
    <>
      <SpotCommerceDashboard studioId={studioId} />
      <ClouvaQrEnginePanel studioId={studioId} />
    </>
  );
}
