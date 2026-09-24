import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluPublicSpotHome } from "@/components/iglu/IgluPublicSpotHome";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
import { IGLU_PUBLIC_ALIAS, IGLU_PUBLIC_PATH, IGLU_STUDIO_PATH } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias, type StudioIdentityData } from "@/lib/server/public-identity-data";
import { siteUrl } from "@/lib/site-url";

const IGLU_LOGO =
  "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other/02_logo_iglu_records_neon_hielo.png";
const TITLE = "El Iglú Records — Estudio, sello y música | CLOUVA";
const DESCRIPTION =
  "El Iglú Records es un estudio, sello y espacio musical dentro de CLOUVA. Grabación, producción, artistas, sesiones, música e IGLÚ Radio.";
const CANONICAL = `${siteUrl}${IGLU_PUBLIC_PATH}`;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: CANONICAL },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: CANONICAL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "CLOUVA",
    images: [{ url: IGLU_LOGO, alt: "El Iglú Records — logo oficial" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [IGLU_LOGO],
  },
};

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

export default async function IgluRecordsPage() {
  const [data, result] = await Promise.all([
    loadIgluSiteData(),
    resolveStudioAlias(IGLU_PUBLIC_ALIAS).catch(() => null),
  ]);

  if (!data) notFound();

  const sameAs = result ? studioSameAs(result).filter((url) => url !== CANONICAL) : [];
  const serviceTopics = result
    ? Array.from(new Set(result.services.flatMap((service) => [service.name, service.category]).filter((value): value is string => Boolean(value))))
    : [];
  const knownTopics = result
    ? Array.from(new Set([...(result.studio.categories || []), ...serviceTopics]))
    : [];
  const members = result
    ? result.players.flatMap((entry) =>
        entry.player
          ? [{ "@type": "Person", name: entry.player.display_name, ...(entry.role || entry.player.primary_role ? { jobTitle: entry.role || entry.player.primary_role } : {}) }]
          : [],
      )
    : [];
  const offers = result
    ? result.services.slice(0, 12).map((service) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: service.name,
          ...(service.description ? { description: service.description } : {}),
          ...(service.category ? { serviceType: service.category } : {}),
        },
      }))
    : [];

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${CANONICAL}#webpage`,
        url: CANONICAL,
        name: "El Iglú Records — perfil oficial en CLOUVA",
        description: DESCRIPTION,
        inLanguage: "es-AR",
        mainEntity: { "@id": `${CANONICAL}#entity` },
      },
      {
        "@type": "Organization",
        "@id": `${CANONICAL}#entity`,
        name: "El Iglú Records",
        alternateName: ["IGLÚ Records", "Iglú Records", "El Iglú", "eliglurecords"],
        url: CANONICAL,
        identifier: IGLU_PUBLIC_ALIAS,
        description: DESCRIPTION,
        disambiguatingDescription: "Estudio y sello musical de CLOUVA, con artistas, producción, sesiones e IGLÚ Radio.",
        slogan: result?.studio.tagline || "Del Sur para el mundo",
        logo: IGLU_LOGO,
        image: IGLU_LOGO,
        ...(sameAs.length ? { sameAs } : {}),
        ...(knownTopics.length ? { knowsAbout: knownTopics } : {}),
        ...(members.length ? { member: members } : {}),
        ...(offers.length ? { makesOffer: offers } : {}),
        parentOrganization: { "@type": "Organization", name: "CLOUVA", url: `${siteUrl}/` },
        subOrganization: {
          "@type": "Organization",
          name: "IGLÚ Radio",
          url: `${siteUrl}${IGLU_STUDIO_PATH}/radio`,
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <IgluPublicSpotHome data={data} />
    </>
  );
}