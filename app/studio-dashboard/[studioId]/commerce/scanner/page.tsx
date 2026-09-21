import { CommercePistolScanner } from "@/components/commerce/CommercePistolScanner";

export default async function CommerceScannerPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  return <CommercePistolScanner studioId={studioId} />;
}
