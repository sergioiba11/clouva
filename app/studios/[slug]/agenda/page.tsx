import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { loadPublicAgendaByStudio } from "@/lib/server/agenda/public";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Agenda no encontrada — CLOUVA", robots: { index: false, follow: false } };
  return {
    title: `Agenda de ${result.studio.name} — CLOUVA`,
    description: `Sesiones, clases, reuniones y fechas públicas de ${result.studio.name}.`,
    alternates: { canonical: `https://clouva.com.ar/studios/${result.canonicalAlias}/agenda` },
  };
}

export default async function StudioAgendaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) redirect(`/studios/${result.canonicalAlias}/agenda`);

  const publicAgenda = await loadPublicAgendaByStudio({ admin: createAdminSupabase(), studioId: result.studio.id });
  if (!publicAgenda) notFound();
  const accent = result.layoutConfig?.page_style?.palette?.accent || result.studio.accent_color || "#8f7cff";

  return (
    <>
      <StudioIdentityRenderer data={result} />
      <PublicAgendaSection
        identityName={result.studio.name}
        agendaHref={`/studios/${result.canonicalAlias}/agenda`}
        accent={accent}
        events={publicAgenda.events}
        bookingEnabled={publicAgenda.agenda.booking_enabled}
        compact={false}
        description="Sesiones, clases, reuniones, grabaciones, lanzamientos y reservas públicas del Studio."
      />
    </>
  );
}
