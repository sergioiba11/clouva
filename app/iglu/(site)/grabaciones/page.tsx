import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
import { resolveIgluServiceOffers } from "@/lib/iglu/service-offers";

export const metadata: Metadata = { title: "Grabaciones" };

const FALLBACK_OFFERS: IgluOffer[] = [
  { name: "1 hora vocal", description: "Grabación profesional de voces en estudio." },
  { name: "4 horas estudio", description: "Más tiempo para desarrollar la sesión dentro del estudio." },
  { name: "Jornada 6 hs", description: "Una jornada extendida para trabajar el proyecto con continuidad." },
  { name: "Canción completa", description: "Voces principales, coros, dobles y edición según el servicio publicado." },
  { name: "Coros y dobles", description: "Capas vocales para sumar profundidad y fuerza al tema." },
];

export default async function Page() {
  const data = await loadIgluSiteData();
  if (!data) notFound();

  const offers = resolveIgluServiceOffers(
    data.services,
    ["grab", "vocal", "voz", "voces", "toma", "coro", "doble"],
    FALLBACK_OFFERS,
  );

  return (
    <IgluServicePage
      data={data}
      kicker="Estudio profesional"
      title="GRABACIONES"
      subtitle="VOCES · TOMAS · COROS · GRABACIÓN PROFESIONAL"
      description="Tu voz, en otro nivel. Grabá en un entorno único con la energía del sur."
      offers={offers}
      ctaLabel="Consultar"
    />
  );
}
