import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlayerPublicView } from "@/components/public/PlayerPublicView";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { loadPublicAgendaByPlayer } from "@/lib/server/agenda";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicAlias: string }> }): Promise<Metadata> {
  const { publicAlias } = await params;
  const result = await resolvePlayerAlias(publicAlias).catch(() => null);
  if (!result) return { title: "Agenda no encontrada — CLOUVA", robots: { index: false, follow: false } };
  return {
    title: `Agenda de ${result.player.display_name} — CLOUVA`,
    description: `Eventos, sesiones y fechas públicas de ${result.player.display_name}.`,
    alternates: { canonical: `https://clouva.com.ar/${result.canonicalAlias}/agenda` },
  };
}

export default async function PlayerPublicAgendaPage({ params }: { params: Promise<{ publicAlias: string }> }) {
  const { publicAlias } = await params;
  const result = await resolvePlayerAlias(publicAlias);
  if (!result) notFound();
  const publicAgenda = await loadPublicAgendaByPlayer({ admin: createAdminSupabase(), playerId: result.player.id });
  if (!publicAgenda) notFound();

  const accent = result.layoutConfig?.page_style?.palette?.accent || result.player.accent_color || "#8f7cff";

  // Keep the Player renderer as the visual source of truth. Agenda is appended
  // as a functional section instead of rebuilding/copying the Player identity.
  return (
    <>
      <PlayerPublicView
        player={result.player}
        affiliations={result.affiliations}
        media={result.media}
        isVip={result.isVip}
        layoutConfig={result.layoutConfig}
      />
      <PublicAgendaSection
        identityName={result.player.display_name}
        agendaHref={`/${result.canonicalAlias}/agenda`}
        accent={accent}
        events={publicAgenda.events}
        bookingEnabled={publicAgenda.agenda.booking_enabled}
        compact={false}
        description="Eventos, sesiones, lanzamientos y fechas públicas de este Player."
      />
    </>
  );
}
