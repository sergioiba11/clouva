import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
import { resolveIgluServiceOffers } from "@/lib/iglu/service-offers";

export const metadata: Metadata = { title: "Producciones" };

const FALLBACK_OFFERS: IgluOffer[] = [
  { name: "Beat Lease MP3", description: "Licencia de beat en MP3 según disponibilidad publicada." },
  { name: "Beat WAV", description: "Licencia en WAV para trabajar con mayor fidelidad." },
  { name: "Beat exclusivo", description: "Producción exclusiva y condiciones definidas por el estudio." },
  { name: "Mezcla", description: "Claridad, balance y potencia para llevar la canción al siguiente nivel." },
  { name: "Master", description: "Terminación final preparada para el lanzamiento." },
];

export default async function Page() {
  const data = await loadIgluSiteData();
  if (!data) notFound();

  const offers = resolveIgluServiceOffers(
    data.services,
    ["beat", "mezcla", "mix", "master", "produccion", "producción"],
    FALLBACK_OFFERS,
  );

  return (
    <IgluServicePage
      data={data}
      kicker="Estudio profesional"
      title="PRODUCCIONES"
      subtitle="BEATS · MEZCLA · MASTER"
      description="Tu visión, nuestra experiencia. De la idea al mundo."
      offers={offers}
      ctaLabel="Consultar"
    />
  );
}
