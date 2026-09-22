import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { IgluPublicSpotHome } from "@/components/iglu/IgluPublicSpotHome";
import { PlayerIdentityRenderer } from "@/components/public/PlayerIdentityRenderer";
import { SpacePublicView } from "@/components/public/SpacePublicView";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { PublicKnowledgeSection } from "@/components/public/PublicKnowledgeSection";
import { PublicMerchSection, loadPublicMerchProducts } from "@/components/public/PublicMerchSection";
import { IGLU_PUBLIC_ALIAS, IGLU_PUBLIC_PATH } from "@/lib/iglu-radio/routes";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
import { buildPlayerStructuredData } from "@/lib/seo/player-structured-data";
import { loadPublicAgendaByPlayer } from "@/lib/server/agenda/public-loader";
import { loadPublicKnowledgeByPlayer } from "@/lib/server/knowledge/public-loader";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { resolvePublicSpaceAlias } from "@/lib/server/public-space-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicAlias: string }> }): Promise<Metadata> {
  const { publicAlias } = await params;
  if (publicAlias.toLowerCase() === IGLU_PUBLIC_ALIAS) {
    const data = await loadIgluSiteData().catch(() => null);
    if (!data) return { title: "El Iglú Records — CLOUVA", robots: { index: false, follow: false } };
    const canonical = `https://clouva.com.ar${IGLU_PUBLIC_PATH}`;
    const title = data.studio.seo_title || "El Iglú Records — estudio, sello y música en CLOUVA";
    const description = data.studio.seo_description || data.studio.description || data.studio.tagline || "El Iglú Records es un sello, estudio y espacio musical dentro de CLOUVA.";
    const image = data.studio.og_image_url || data.studio.cover_url || data.publicStudio.darkLogoUrl || data.studio.logo_url || undefined;
    return {
      title,
      description,
      alternates: { canonical },
      robots: { index: true, follow: true },
      openGraph: { type: "website", url: canonical, title, description, images: image ? [{ url: image, alt: "El Iglú — IGLÚ Records en CLOUVA" }] : undefined, siteName: "CLOUVA" },
      twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
    };
  }
  const playerResult = await resolvePlayerAlias(publicAlias).catch(() => null);
  if (playerResult) {
    const { player, canonicalAlias } = playerResult;
    const title = player.seo_title || `${player.display_name} — Perfil oficial`;
    const description = player.seo_description || player.share_description || player.long_bio || player.short_bio || player.tagline || undefined;
    const canonical = `https://clouva.com.ar/${canonicalAlias}`;
    const image = player.og_image_url || player.cover_url || player.profile_image_url || undefined;
    const socialTitle = player.share_title || title;
    const socialDescription = player.share_description || description;
    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        type: "profile",
        siteName: "CLOUVA",
        locale: "es_AR",
        url: canonical,
        title: socialTitle,
        description: socialDescription,
        images: image ? [{ url: image, alt: `${player.display_name}${player.public_identity_label ? `, ${player.public_identity_label.toLowerCase()}` : ""}` }] : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: socialTitle,
        description: socialDescription,
        images: image ? [image] : undefined,
      },
      robots: player.privacy_status === "public" ? { index: true, follow: true } : { index: false, follow: false },
    };
  }
  const spaceResult = await resolvePublicSpaceAlias(publicAlias).catch(() => null);
  if (!spaceResult) return { title: "Perfil no encontrado — CLOUVA", robots: { index: false, follow: false } };
  const { space, spot, canonicalAlias } = spaceResult;
  const title = `${space.name} — CLOUVA`;
  const description = spot?.description || space.description || `Spot oficial de ${space.name} en CLOUVA Matrix.`;
  const canonical = `https://clouva.com.ar/${canonicalAlias}`;
  const image = spot?.cover_url || spot?.logo_url || space.cover_url || space.logo_url || undefined;
  return { title, description, alternates: { canonical }, openGraph: { type: "website", url: canonical, title, description, images: image ? [{ url: image }] : undefined }, robots: { index: true, follow: true } };
}

export default async function PublicAliasPage({ params }: { params: Promise<{ publicAlias: string }> }) {
  const { publicAlias } = await params;
  if (publicAlias.toLowerCase() === IGLU_PUBLIC_ALIAS) {
    const data = await loadIgluSiteData();
    if (!data) notFound();
    const canonical = `https://clouva.com.ar${IGLU_PUBLIC_PATH}`;
    const description = data.studio.seo_description || data.studio.description || data.studio.tagline || "El Iglú Records es un sello, estudio y espacio musical dentro de CLOUVA.";
    const structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "@id": `${canonical}#webpage`,
          url: canonical,
          name: "El Iglú Records — perfil oficial en CLOUVA",
          description,
          inLanguage: "es-AR",
          mainEntity: { "@id": `${canonical}#entity` },
        },
        {
          "@type": "Organization",
          "@id": `${canonical}#entity`,
          name: "El Iglú Records",
          alternateName: ["IGLÚ Records", "Iglú Records", "El Iglú", "eliglurecords"],
          url: canonical,
          mainEntityOfPage: { "@id": `${canonical}#webpage` },
          description,
          slogan: data.studio.tagline || "Del Sur para el mundo",
          logo: data.publicStudio.darkLogoUrl || data.studio.logo_url || undefined,
          image: data.studio.og_image_url || data.studio.cover_url || undefined,
          parentOrganization: { "@type": "Organization", name: "CLOUVA", url: "https://clouva.com.ar/" },
        },
      ],
    };
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
        <IgluPublicSpotHome data={data} />
      </>
    );
  }
  const playerResult = await resolvePlayerAlias(publicAlias);
  if (playerResult && publicAlias.toLowerCase() !== playerResult.canonicalAlias.toLowerCase()) {
    redirect(`/${playerResult.canonicalAlias}`);
  }
  if (!playerResult) {
    const spaceResult = await resolvePublicSpaceAlias(publicAlias);
    if (!spaceResult) notFound();
    return <SpacePublicView data={spaceResult} />;
  }

  const admin = createAdminSupabase();
  const [merchProducts, publicAgenda, publicKnowledge] = await Promise.all([
    loadPublicMerchProducts({ playerId: playerResult.player.id }),
    loadPublicAgendaByPlayer({ admin, playerId: playerResult.player.id }).catch(() => null),
    loadPublicKnowledgeByPlayer({ admin, playerId: playerResult.player.id }).catch(() => null),
  ]);
  const accent = playerResult.layoutConfig?.page_style?.palette?.accent || playerResult.player.accent_color || "#8f7cff";
  const structuredData = buildPlayerStructuredData({
    player: playerResult.player,
    canonicalAlias: playerResult.canonicalAlias,
    musicConnections: playerResult.musicConnections,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <PlayerIdentityRenderer
        player={playerResult.player}
        affiliations={playerResult.affiliations}
        media={playerResult.media}
        isVip={playerResult.isVip}
        layoutConfig={playerResult.layoutConfig}
        hasMerch={merchProducts.length > 0}
      />
      {publicKnowledge ? <PublicKnowledgeSection playerName={playerResult.player.display_name} alias={playerResult.canonicalAlias} accent={accent} knowledge={publicKnowledge} /> : null}
      {publicAgenda ? <PublicAgendaSection identityName={playerResult.player.display_name} agendaHref={`/${playerResult.canonicalAlias}/agenda`} accent={accent} events={publicAgenda.events} bookingEnabled={publicAgenda.agenda.booking_enabled} description="Eventos, sesiones y fechas públicas de este Player." /> : null}
      <PublicMerchSection playerId={playerResult.player.id} products={merchProducts} eyebrow={`Merch de ${playerResult.player.display_name}`} title="Tienda" />
    </>
  );
}
