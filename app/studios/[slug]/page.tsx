import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { TrebolContextRegistration } from "@/components/clouva-ai/TrebolContextRegistration";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { PublicMerchSection } from "@/components/public/PublicMerchSection";
import { loadPublicAgendaByStudio } from "@/lib/server/agenda/public";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Estudio no encontrado — CLOUVA", robots: { index: false, follow: false } };
  const canonical = `https://clouva.com.ar/studios/${result.canonicalAlias}`;
  const title = `${result.studio.name} — Estudio`;
  const description = result.studio.description || result.studio.tagline || undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description,
      images: result.studio.cover_url ? [{ url: result.studio.cover_url }] : undefined,
    },
  };
}

export default async function StudioProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) {
    redirect(`/studios/${result.canonicalAlias}${query.joined === "1" ? "?joined=1" : ""}`);
  }

  const publicAgenda = await loadPublicAgendaByStudio({ admin: createAdminSupabase(), studioId: result.studio.id }).catch(() => null);
  const accent = result.layoutConfig?.page_style?.palette?.accent || result.studio.accent_color || "#8f7cff";
  const merch = (
    <PublicMerchSection
      studioId={result.studio.id}
      eyebrow={`Tienda de ${result.studio.name}`}
      title="Merch"
    />
  );

  // Agenda extends the canonical Studio identity; it never replaces or forks
  // the fixed/template/precise renderer selected by StudioIdentityRenderer.
  return (
    <>
      <TrebolContextRegistration
        scope="studio-public"
        id={result.studio.id}
        data={{
          studioId: result.studio.id,
          slug: result.studio.slug,
          name: result.studio.name,
          section: "public-profile",
        }}
      />
      <StudioIdentityRenderer data={result} joined={query.joined === "1"} />
      {publicAgenda ? (
        <PublicAgendaSection
          identityName={result.studio.name}
          agendaHref={`/studios/${result.canonicalAlias}/agenda`}
          accent={accent}
          events={publicAgenda.events}
          bookingEnabled={publicAgenda.agenda.booking_enabled}
          description="Sesiones, clases, reuniones, grabaciones, lanzamientos y reservas públicas del Studio."
        />
      ) : null}
      {merch}
    </>
  );
}
