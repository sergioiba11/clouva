import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { StudioIdentityRenderer } from "@/components/public/StudioIdentityRenderer";
import { TrebolContextRegistration } from "@/components/clouva-ai/TrebolContextRegistration";
import { PublicAgendaSection } from "@/components/public/PublicAgendaSection";
import { PublicMerchSection } from "@/components/public/PublicMerchSection";
import { IgluPublicSpotHome } from "@/components/iglu/IgluPublicSpotHome";
import { loadPublicAgendaByStudio } from "@/lib/server/agenda/public";
import { resolveStudioAlias, type StudioIdentityData } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";
import { studioPublicHref } from "@/lib/public-studio-routes";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

function canonicalUrl(alias: string) {
  return `${siteUrl}${studioPublicHref(alias)}`;
}

function absoluteAssetUrl(url: string | null | undefined) {
  if (!url) return undefined;
  return url.startsWith("/") ? `${siteUrl}${url}` : url;
}

function publicHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function studioSameAs(result: StudioIdentityData) {
  const candidates: unknown[] = [result.studio.website_url];
  if (Array.isArray(result.studio.social_links)) {
    for (const entry of result.studio.social_links) {
      if (entry && typeof entry === "object" && "url" in entry) {
        candidates.push((entry as { url?: unknown }).url);
      }
    }
  }
  return Array.from(new Set(candidates.map(publicHttpUrl).filter((url): url is string => Boolean(url))));
}

function presentationLogo(result: StudioIdentityData) {
  return result.layoutConfig?.page_style?.theme === "light"
    ? result.publicStudio.lightLogoUrl || result.publicStudio.logoUrl || result.studio.logo_url
    : result.publicStudio.darkLogoUrl || result.publicStudio.logoUrl || result.studio.logo_url;
}

function publicIdentityData(result: StudioIdentityData): StudioIdentityData {
  const logo = presentationLogo(result);
  return {
    ...result,
    studio: { ...result.studio, name: result.publicStudio.publicName, logo_url: logo },
    layoutConfig: result.layoutConfig
      ? { ...result.layoutConfig, image_slots: { ...result.layoutConfig.image_slots, ...(logo ? { logo, "brand-lockup": logo } : {}) } }
      : null,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Estudio no encontrado — CLOUVA", robots: { index: false, follow: false } };

  const canonical = canonicalUrl(result.canonicalAlias);
  const isIglu = result.studio.slug.toLowerCase() === IGLU_STUDIO_SLUG;
  const title = result.studio.seo_title || (isIglu ? "El Iglú Records — estudio, sello y música en CLOUVA" : `${result.publicStudio.publicName} — Estudio en CLOUVA`);
  const description = result.studio.seo_description || result.studio.description || result.studio.tagline || (isIglu ? "El Iglú Records es un sello, estudio y espacio musical dentro de CLOUVA: grabación, producción, artistas, sesiones e IGLÚ Radio." : undefined);
  const image = absoluteAssetUrl(result.studio.og_image_url || result.studio.cover_url || result.publicStudio.darkLogoUrl || result.studio.logo_url);

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: canonical, title: result.studio.share_title || title, description: result.studio.share_description || description, images: image ? [{ url: image, alt: isIglu ? "El Iglú — IGLÚ Records en CLOUVA" : result.publicStudio.publicName }] : undefined, siteName: "CLOUVA" },
    twitter: { card: image ? "summary_large_image" : "summary", title: result.studio.share_title || title, description: result.studio.share_description || description, images: image ? [image] : undefined },
  };
}

export default async function MatrixStudioProfilePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ joined?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();

  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) permanentRedirect(`${studioPublicHref(result.canonicalAlias)}${query.joined === "1" ? "?joined=1" : ""}`);

  const isIglu = result.studio.slug.toLowerCase() === IGLU_STUDIO_SLUG;
  const canonical = canonicalUrl(result.canonicalAlias);
  const structuredDescription = result.studio.seo_description || result.studio.description || result.studio.tagline || (isIglu ? "El Iglú Records es un sello, estudio y espacio musical dentro de CLOUVA: grabación, producción, artistas, sesiones e IGLÚ Radio." : undefined);
  const structuredLogo = absoluteAssetUrl(result.publicStudio.darkLogoUrl || result.studio.logo_url);
  const structuredImage = absoluteAssetUrl(result.studio.og_image_url || result.studio.cover_url || result.publicStudio.darkLogoUrl || result.studio.logo_url);

  if (isIglu) {
    const igluData = await loadIgluSiteData();
    if (!igluData) notFound();
    const serviceTopics = Array.from(new Set(result.services.flatMap((service) => [service.name, service.category]).filter((value): value is string => Boolean(value))));
    const knownTopics = Array.from(new Set([...(result.studio.categories || []), ...serviceTopics]));
    const sameAs = studioSameAs(result).filter((url) => url !== canonical);
    const locationName = [result.studio.city, result.studio.country].filter(Boolean).join(", ");
    const members = result.players.flatMap((entry) => entry.player ? [{
      "@type": "Person",
      name: entry.player.display_name,
      ...(entry.role || entry.player.primary_role ? { jobTitle: entry.role || entry.player.primary_role } : {}),
    }] : []);
    const offers = result.services.slice(0, 12).map((service) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: service.name,
        ...(service.description ? { description: service.description } : {}),
        ...(service.category ? { serviceType: service.category } : {}),
      },
    }));
    const structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "@id": `${canonical}#webpage`,
          url: canonical,
          name: "El Iglú Records — perfil oficial en CLOUVA",
          description: structuredDescription,
          inLanguage: "es-AR",
          mainEntity: { "@id": `${canonical}#entity` },
        },
        {
          "@type": "Organization",
          "@id": `${canonical}#entity`,
          name: "El Iglú Records",
          alternateName: Array.from(new Set([
            "IGLÚ Records",
            "Iglú Records",
            "El Iglú",
            result.publicStudio.publicName,
            result.studio.name,
            result.canonicalAlias,
            result.studio.slug,
          ].filter(Boolean))),
          url: canonical,
          mainEntityOfPage: { "@id": `${canonical}#webpage` },
          description: structuredDescription,
          disambiguatingDescription: "Entidad musical de CLOUVA que reúne estudio de grabación, producción, artistas, sesiones e IGLÚ Radio.",
          slogan: result.studio.tagline || "Del Sur para el mundo",
          logo: structuredLogo,
          image: structuredImage,
          ...(sameAs.length ? { sameAs } : {}),
          ...(result.studio.contact_email ? { email: result.studio.contact_email } : {}),
          ...(locationName ? { location: { "@type": "Place", name: locationName } } : {}),
          ...(knownTopics.length ? { knowsAbout: knownTopics } : {}),
          ...(members.length ? { member: members } : {}),
          ...(offers.length ? { makesOffer: offers } : {}),
          parentOrganization: { "@type": "Organization", "@id": `${siteUrl}/#organization`, name: "CLOUVA", url: `${siteUrl}/` },
          subOrganization: { "@id": `${canonical}/radio#entity` },
        },
        {
          "@type": "Organization",
          "@id": `${canonical}/radio#entity`,
          name: "IGLÚ Radio",
          url: `${canonical}/radio`,
          description: "La radio oficial de IGLÚ Records dentro de CLOUVA: música, cultura urbana, sesiones y transmisión en vivo.",
          parentOrganization: { "@id": `${canonical}#entity` },
        },
      ],
    };
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
        <IgluPublicSpotHome data={igluData} />
      </>
    );
  }

  const data = publicIdentityData(result);
  const publicAgenda = await loadPublicAgendaByStudio({ admin: createAdminSupabase(), studioId: result.studio.id }).catch(() => null);
  const accent = data.layoutConfig?.page_style?.palette?.accent || data.studio.accent_color || "#8f7cff";
  const structuredName = result.publicStudio.publicName;
  const alternateNames = Array.from(new Set([result.studio.name, result.studio.slug, ...result.publicStudio.aliases].filter((value): value is string => Boolean(value && value.toLowerCase() !== structuredName.toLowerCase()))));
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${canonical}#studio`,
    name: structuredName,
    alternateName: alternateNames.length ? alternateNames : undefined,
    url: canonical,
    description: structuredDescription,
    logo: structuredLogo,
    image: structuredImage,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <TrebolContextRegistration scope="studio-public" id={result.studio.id} data={{ studioId: result.studio.id, slug: result.studio.slug, canonicalAlias: result.canonicalAlias, name: result.publicStudio.publicName, section: "public-profile" }} />
      <StudioIdentityRenderer data={data} joined={query.joined === "1"} />
      {publicAgenda ? <PublicAgendaSection identityName={result.publicStudio.publicName} agendaHref={`${result.publicStudio.href}/agenda`} accent={accent} events={publicAgenda.events} bookingEnabled={publicAgenda.agenda.booking_enabled} description="Sesiones, clases, reuniones, grabaciones, lanzamientos y reservas públicas del Studio." /> : null}
      <PublicMerchSection studioId={result.studio.id} eyebrow={`Tienda de ${result.publicStudio.publicName}`} title="Merch" />
    </>
  );
}
