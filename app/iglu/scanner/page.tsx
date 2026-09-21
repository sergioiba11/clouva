import { CommercePistolScanner } from "@/components/commerce/CommercePistolScanner";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export default async function IgluScannerPage() {
  const result = await resolveStudioAlias("el-iglu");
  if (!result?.studio?.id) {
    throw new Error("No se pudo resolver El Iglú.");
  }
  return <CommercePistolScanner studioId={result.studio.id} />;
}
