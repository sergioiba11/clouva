import { notFound, permanentRedirect } from "next/navigation";
import { IGLU_STUDIO_SLUG, igluRadioRoute } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export default async function MatrixIgluStudioRadioRoute({ params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path = [] } = await params;
  const studio = await resolveStudioAlias(slug);
  if (!studio || studio.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();

  permanentRedirect(igluRadioRoute(path.join("/")));
}
