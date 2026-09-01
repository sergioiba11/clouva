import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlayerPublicView } from "@/components/public/PlayerPublicView";
import { PublicMerchSection, loadPublicMerchProducts } from "@/components/public/PublicMerchSection";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicAlias: string }> }): Promise<Metadata> {
  const { publicAlias } = await params;
  const result = await resolvePlayerAlias(publicAlias).catch(() => null);
  if (!result) return { title: "Perfil no encontrado — CLOUVA", robots: { index: false, follow: false } };

  const { player, canonicalAlias } = result;
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

export default async function PublicPlayerAliasPage({ params }: { params: Promise<{ publicAlias: string }> }) {
  const { publicAlias } = await params;
  const result = await resolvePlayerAlias(publicAlias);
  if (!result) notFound();
  const merchProducts = await loadPublicMerchProducts({ playerId: result.player.id });

  return (
    <>
      <PlayerPublicView
        player={result.player}
        affiliations={result.affiliations}
        media={result.media}
        isVip={result.isVip}
        layoutConfig={result.layoutConfig}
        hasMerch={merchProducts.length > 0}
      />
      <PublicMerchSection
        playerId={result.player.id}
        products={merchProducts}
        eyebrow={`Merch de ${result.player.display_name}`}
        title="Tienda"
      />
    </>
  );
}
