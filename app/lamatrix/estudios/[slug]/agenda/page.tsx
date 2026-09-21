import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { IgluUnifiedCalendar } from "@/components/iglu/IgluUnifiedCalendar";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { loadCanonicalPublicAgenda, loadPublicAgendaByStudio } from "@/lib/server/agenda/public-loader";
import { loadIgluOperationalData } from "@/lib/server/iglu/public-app";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  const canonical = result ? `${siteUrl}${result.publicStudio.href}/agenda` : undefined;
  return {
    title: result?.studio.slug === IGLU_STUDIO_SLUG ? "Reservas — El Iglú Records" : "Agenda — CLOUVA",
    alternates: canonical ? { canonical } : undefined,
    robots: { index: false, follow: true },
  };
}

export default async function MatrixStudioAgendaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) permanentRedirect(`${result.publicStudio.href}/agenda`);

  if (result.studio.slug.toLowerCase() === IGLU_STUDIO_SLUG) {
    const data = await loadIgluOperationalData();
    if (!data) notFound();
    return (
      <IgluUnifiedCalendar
        players={data.players}
        events={data.events}
        availabilityRules={data.availabilityRules}
        timezone={data.studioAgenda?.timezone || "America/Argentina/Buenos_Aires"}
        bookingEnabled={Boolean(data.studioAgenda?.booking_enabled)}
      />
    );
  }

  const agenda = await loadPublicAgendaByStudio(result.studio.id);
  if (!agenda) notFound();
  const canonical = await loadCanonicalPublicAgenda("space", agenda.agenda.ownerSpaceId || "");
  if (!canonical) notFound();

  return (
    <StudioIdentityRenderer data={result} context="agenda">
      <PublicAgendaSection
        identityName={result.publicStudio.publicName}
        agendaHref={`${result.publicStudio.href}/agenda`}
        accent={result.studio.palette?.primary || result.studio.accent_color || "#8b5cf6"}
        events={canonical.events}
        bookingEnabled={agenda.agenda.bookingEnabled}
        compact={false}
      />
    </StudioIdentityRenderer>
  );
}
