import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { TrebolContextRegistration } from "@/components/clouva-ai/TrebolContextRegistration";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { PublicMerchSection } from "@/components/public/PublicMerchSection";
import { loadPublicAgendaByStudio } from "@/lib/server/agenda/public";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";
import { IGLU_RADIO_PATH, IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { studioPublicHref } from "@/lib/public-studio-routes";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

function canonicalUrl(alias: string) {
  return `${siteUrl}${studioPublicHref(alias)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Estudio no encontrado — CLOUVA", robots: { index: false, follow: false } };

  const canonical = canonicalUrl(result.canonicalAlias);
  const title = result.studio.seo_title || `${result.studio.name} — Estudio en CLOUVA`;
  const description = result.studio.seo_description || result.studio.description || result.studio.tagline || undefined;
  const image = result.studio.og_image_url || result.studio.cover_url || result.studio.logo_url || undefined;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: canonical,
      title: result.studio.share_title || title,
      description: result.studio.share_description || description,
      images: image ? [{ url: image }] : undefined,
      siteName: "CLOUVA",
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: result.studio.share_title || title,
      description: result.studio.share_description || description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function MatrixStudioProfilePage({
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
    permanentRedirect(`${studioPublicHref(result.canonicalAlias)}${query.joined === "1" ? "?joined=1" : ""}`);
  }

  const publicAgenda = await loadPublicAgendaByStudio({ admin: createAdminSupabase(), studioId: result.studio.id }).catch(() => null);
  const accent = result.layoutConfig?.page_style?.palette?.accent || result.studio.accent_color || "#8f7cff";
  const isIglu = result.studio.slug.toLowerCase() === IGLU_STUDIO_SLUG;
  const canonical = canonicalUrl(result.canonicalAlias);
  const structuredName = result.studio.share_title || result.studio.name;
  const structuredDescription = result.studio.seo_description || result.studio.description || result.studio.tagline || undefined;
  const alternateNames = Array.from(new Set([
    result.studio.name,
    result.studio.share_title,
    result.studio.slug,
    result.canonicalAlias,
  ].filter((value): value is string => Boolean(value && value !== structuredName))));
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${canonical}#studio`,
    name: structuredName,
    alternateName: alternateNames.length ? alternateNames : undefined,
    url: canonical,
    description: structuredDescription,
    logo: result.studio.logo_url || undefined,
    image: result.studio.og_image_url || result.studio.cover_url || result.studio.logo_url || undefined,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <TrebolContextRegistration
        scope="studio-public"
        id={result.studio.id}
        data={{
          studioId: result.studio.id,
          slug: result.studio.slug,
          canonicalAlias: result.canonicalAlias,
          name: result.studio.name,
          section: "public-profile",
        }}
      />
      <StudioIdentityRenderer data={result} joined={query.joined === "1"} />
      {isIglu ? (
        <section className="border-y border-white/10 bg-[#03070b] px-4 py-8 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 rounded-[28px] border border-white/10 bg-white/[0.025] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="max-w-2xl">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>IGLÚ RADIO · IGLÚ RECORDS</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">La radio vive dentro de este Studio.</h2>
              <p className="mt-3 text-sm leading-6 text-white/55">Entrá a la señal, sesiones, artistas, programas y programación de IGLÚ RADIO sin salir de la identidad oficial de IGLÚ RECORDS.</p>
            </div>
            <Link
              href={IGLU_RADIO_PATH}
              className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full border border-white/15 px-6 text-xs font-bold tracking-[0.12em] text-white shadow-lg transition hover:brightness-125"
              style={{ backgroundColor: accent }}
            >
              ENTRAR A IGLÚ RADIO
            </Link>
          </div>
        </section>
      ) : null}
      {publicAgenda ? (
        <PublicAgendaSection
          identityName={result.studio.share_title || result.studio.name}
          agendaHref={`/studios/${result.studio.slug}/agenda`}
          accent={accent}
          events={publicAgenda.events}
          bookingEnabled={publicAgenda.agenda.booking_enabled}
          description="Sesiones, clases, reuniones, grabaciones, lanzamientos y reservas públicas del Studio."
        />
      ) : null}
      <PublicMerchSection
        studioId={result.studio.id}
        eyebrow={`Tienda de ${result.studio.share_title || result.studio.name}`}
        title="Merch"
      />
    </>
  );
}
