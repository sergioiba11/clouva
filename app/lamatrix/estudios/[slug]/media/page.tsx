import { notFound } from "next/navigation";
import { IgluMediaLive } from "@/components/iglu/IgluMediaLive";
import { IGLU_PUBLIC_ALIAS, IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export default async function IgluMediaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const identity = await resolveStudioAlias(slug);
  if (!identity || identity.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  return <IgluMediaLive studioId={identity.studio.id} studioName={identity.publicStudio.publicName} publicAlias={IGLU_PUBLIC_ALIAS} />;
}
