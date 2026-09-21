import { notFound } from "next/navigation";
import { IgluCurrentPlayerRedirect } from "@/components/iglu/IgluCurrentPlayerRedirect";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export default async function IgluCurrentPlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const studio = await resolveStudioAlias(slug);
  if (!studio || studio.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  return <IgluCurrentPlayerRedirect />;
}
