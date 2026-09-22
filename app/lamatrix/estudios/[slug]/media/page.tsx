import { notFound, permanentRedirect } from "next/navigation";
import { IGLU_MEDIA_PATH, IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export default async function LegacyIgluMediaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await resolveStudioAlias(slug);
  if (!identity || identity.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  permanentRedirect(IGLU_MEDIA_PATH);
}
