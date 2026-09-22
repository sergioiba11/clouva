import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluAdminHome } from "@/components/iglu/IgluAdminHome";
import { IGLU_MEDIA_PATH, IGLU_PUBLIC_ALIAS, IGLU_PUBLIC_PATH } from "@/lib/iglu-radio/routes";
import { loadIgluSiteData } from "@/lib/iglu/site-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administración · El Iglú Records · CLOUVA",
  robots: { index: false, follow: false },
};

export default async function IgluAdminPage({
  params,
}: {
  params: Promise<{ publicAlias: string }>;
}) {
  const { publicAlias } = await params;
  if (publicAlias.toLowerCase() !== IGLU_PUBLIC_ALIAS) notFound();

  const data = await loadIgluSiteData();
  if (!data) notFound();

  return (
    <IgluAdminHome
      studioId={data.studio.id}
      studioName={data.studio.name || "El Iglú Records"}
      logoUrl={data.publicStudio.darkLogoUrl || data.assets.logo || data.studio.logo_url}
      backgroundUrl={data.assets.homeScene || data.assets.studioHero || data.studio.cover_url}
      publicPath={IGLU_PUBLIC_PATH}
      mediaPath={IGLU_MEDIA_PATH}
      agendaPath={IGLU_PUBLIC_PATH + "/agenda"}
    />
  );
}
