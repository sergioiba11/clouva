import { notFound } from "next/navigation";
import { IgluBookingDiscovery } from "@/components/iglu/IgluBookingDiscovery";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { loadIgluOperationalData } from "@/lib/server/iglu/public-app";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export default async function IgluReservePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; time?: string; player?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const identity = await resolveStudioAlias(slug);
  if (!identity || identity.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  const data = await loadIgluOperationalData();
  if (!data) notFound();

  return (
    <IgluBookingDiscovery
      studioId={identity.studio.id}
      players={data.players}
      services={data.services}
      events={data.events}
      availabilityRules={data.availabilityRules}
      bookingEnabled={Boolean(data.studioAgenda?.booking_enabled)}
      timezone={data.studioAgenda?.timezone || "America/Argentina/Buenos_Aires"}
      initialDate={query.date || null}
      initialTime={query.time || null}
      initialPlayerId={query.player || null}
    />
  );
}
