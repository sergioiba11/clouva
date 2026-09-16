import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
import { resolveIgluServiceOffers } from "@/lib/iglu/service-offers";

export const metadata: Metadata = { title: "Sesiones" };

const FALLBACK_OFFERS: IgluOffer[] = [
  { name: "IGLÚ Session Solo", description: "Tu momento. Tu música. Nuestro estudio." },
  { name: "Cypher Slot", description: "Voces que se encuentran. Cultura que crece." },
  { name: "Live Video Take", description: "Performance audiovisual dentro del universo IGLÚ." },
  { name: "Acoustic Set", description: "Una sesión centrada en la interpretación y la esencia del tema." },
  { name: "Backstage Interview", description: "Historias y contexto alrededor de la música." },
];

export default async function Page() {
  const data = await loadIgluSiteData();
  if (!data) notFound();

  const offers = resolveIgluServiceOffers(
    data.services,
    ["session", "sesion", "sesión", "cypher", "acoustic", "acust", "video", "performance", "backstage"],
    FALLBACK_OFFERS,
  );

  return (
    <IgluServicePage
      data={data}
      kicker="IGLÚ Records"
      title="SESIONES"
      subtitle="SESIONES EN VIVO · CYPHERS · ACÚSTICOS · PERFORMANCE"
      description="La música también habita en lugares fríos. Grabá, compartí, conectá."
      offers={offers}
      ctaLabel="Consultar"
    />
  );
}
