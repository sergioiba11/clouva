import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { IgluMediaLive } from "@/components/iglu/IgluMediaLive";
import { IGLU_MEDIA_PATH, IGLU_PUBLIC_ALIAS, IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Media / Live — El Iglú Records",
  description: "Kick, YouTube Live, podcast y música de IGLÚ Records dentro de CLOUVA.",
  alternates: { canonical: `https://clouva.com.ar${IGLU_MEDIA_PATH}` },
  robots: { index: true, follow: true },
};

export default async function PublicIgluMediaPage({
  params,
}: {
  params: Promise<{ publicAlias: string }>;
}) {
  const { publicAlias } = await params;
  if (publicAlias.toLowerCase() !== IGLU_PUBLIC_ALIAS) notFound();
  if (publicAlias !== IGLU_PUBLIC_ALIAS) permanentRedirect(IGLU_MEDIA_PATH);

  const identity = await resolveStudioAlias(IGLU_PUBLIC_ALIAS);
  if (!identity || identity.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();

  return (
    <IgluMediaLive
      studioId={identity.studio.id}
      studioName={identity.publicStudio.publicName}
      publicAlias={IGLU_PUBLIC_ALIAS}
    />
  );
}
