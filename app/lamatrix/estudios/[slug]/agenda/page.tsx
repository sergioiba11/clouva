import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { IgluUnifiedCalendar } from "@/components/iglu/IgluUnifiedCalendar";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { loadPublicAgendaByStudio } from "@/lib/server/agenda/public";
import { loadIgluOperationalData } from "@/lib/server/iglu/public-app";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Agenda no encontrada — CLOUVA", robots: { index: false, follow: false } };
  const canonical = `${siteUrl}${result.publicStudio.href}/agenda`;
  return {
    title: result.studio.slug.toLowerCase() === IGLU_STUDIO_SLUG
      ? "Reservas — El Iglú Records"
      : `Agenda de ${result.publicStudio.publicName} — CLOUVA`,
    description: `Sesiones, clases, reuniones y fechas públicas de ${result.publicStudio.publicName}.`,
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

export default async function MatrixStudioAgendaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) permanentRedirect(`${result.publicStudio.href}/agenda`);

  if (result.studio.slug.toLowerCase() === IGLU_STUDIO_SLUG) {
    const iglu = await loadIgluOperationalData();
    if (!iglu) notFound();
    return (
      <IgluUnifiedCalendar
        players={iglu.players}
        events={iglu.events}
        availabilityRules={iglu.availabilityRules}
        timezone={iglu.studioAgenda?.timezone || "America/Argentina/Buenos_Aires"}
        bookingEnabled={Boolean(iglu.studioAgenda?.booking_enabled)}
      />
    );
  }

  const publicAgenda = await loadPublicAgendaByStudio({ admin: createAdminSupabase(), studioId: result.studio.id });
  if (!publicAgenda) notFound();
  const accent = result.layoutConfig?.page_style?.palette?.accent || result.studio.accent_color || "#8f7cff";
  const logo = result.publicStudio.logoUrl || result.studio.logo_url;
  const data = {
    ...result,
    studio: { ...result.studio, name: result.publicStudio.publicName, logo_url: logo },
    layoutConfig: result.layoutConfig
      ? {
          ...result.layoutConfig,
          image_slots: {
            ...result.layoutConfig.image_slots,
            ...(logo ? { logo, "brand-lockup": logo } : {}),
          },
        }
      : null,
  };

  return (
    <>
      <StudioIdentityRenderer data={data} />
      <PublicAgendaSection
        identityName={result.publicStudio.publicName}
        agendaHref={`${result.publicStudio.href}/agenda`}
        accent={accent}
        events={publicAgenda.events}
        bookingEnabled={publicAgenda.agenda.booking_enabled}
        compact={false}
        description="Sesiones, clases, reuniones, grabaciones, lanzamientos y reservas públicas del Studio."
      />
    </>
  );
}
