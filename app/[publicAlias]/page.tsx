import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlayerPublicView } from "@/components/public/PlayerPublicView";
import { SpacePublicView } from "@/components/public/SpacePublicView";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { PublicKnowledgeSection } from "@/components/public/PublicKnowledgeSection";
import { PublicMerchSection, loadPublicMerchProducts } from "@/components/public/PublicMerchSection";
import { loadPublicAgendaByPlayer } from "@/lib/server/agenda/public-loader";
import { loadPublicKnowledgeByPlayer } from "@/lib/server/knowledge/public-loader";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { resolvePublicSpaceAlias } from "@/lib/server/public-space-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicAlias: string }> }): Promise<Metadata> {
  const { publicAlias } = await params;
  const playerResult = await resolvePlayerAlias(publicAlias).catch(() => null);

  if (playerResult) {
    const { player, canonicalAlias } = playerResult;
    const title = player.seo_title || `${player.display_name} — Perfil oficial`;
    const description = player.seo_description || player.share_description || player.short_bio || player.tagline || undefined;
    const canonical = `https://clouva.com.ar/${canonicalAlias}`;
    const image = player.og_image_url || player.cover_url || player.profile_image_url || undefined;

    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        type: "profile",
        url: canonical,
        title: player.share_title || title,
        description,
        images: image ? [{ url: image }] : undefined,
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

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function PublicAliasPage({ params }: { params: Promise<{ publicAlias: string }> }) {
  const { publicAlias } = await params;
  const playerResult = await resolvePlayerAlias(publicAlias);

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

  return (
    <>
      <PlayerPublicView
        player={playerResult.player}
        affiliations={playerResult.affiliations}
        media={playerResult.media}
        isVip={playerResult.isVip}
        layoutConfig={playerResult.layoutConfig}
        hasMerch={merchProducts.length > 0}
      />
      {publicKnowledge ? (
        <PublicKnowledgeSection
          playerName={playerResult.player.display_name}
          alias={playerResult.canonicalAlias}
          accent={accent}
          knowledge={publicKnowledge}
        />
      ) : null}
      {publicAgenda ? (
        <PublicAgendaSection
          identityName={playerResult.player.display_name}
          agendaHref={`/${playerResult.canonicalAlias}/agenda`}
          accent={accent}
          events={publicAgenda.events}
          bookingEnabled={publicAgenda.agenda.booking_enabled}
          description="Eventos, sesiones y fechas públicas de este Player."
        />
      ) : null}
      <PublicMerchSection
        playerId={playerResult.player.id}
        products={merchProducts}
        eyebrow={`Merch de ${playerResult.player.display_name}`}
        title="Tienda"
      />
    </>
  );
}
