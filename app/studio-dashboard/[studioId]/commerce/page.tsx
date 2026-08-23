import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";

export default async function StudioCommercePage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  return <SpotCommerceDashboard studioId={studioId} />;
}

