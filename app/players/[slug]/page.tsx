import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PlayerPublicView } from "@/components/public/PlayerPublicView";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolvePlayerAlias(slug).catch(() => null);
  if (!result) return { title: "Perfil no encontrado — CLOUVA", robots: { index: false, follow: false } };
  return {
    title: result.player.seo_title || `${result.player.display_name} — Perfil oficial`,
    description: result.player.seo_description || result.player.short_bio || undefined,
    alternates: { canonical: `https://clouva.com.ar/${result.canonicalAlias}` },
    robots: { index: false, follow: true },
  };
}

export default async function LegacyPlayerProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolvePlayerAlias(slug);
  if (!result) notFound();

  if (result.canonicalAlias) redirect(`/${result.canonicalAlias}`);

  return (
    <PlayerPublicView
      player={result.player}
      affiliations={result.affiliations}
      media={result.media}
      isVip={result.isVip}
      layoutConfig={result.layoutConfig}
    />
  );
}
