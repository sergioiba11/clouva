import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";

export const metadata: Metadata = { title: "Producciones" };
const OFFERS: IgluOffer[] = [
  { name:"Beat Lease MP3", description:"Uso comercial · alta calidad. Ideal para empezar.", usd:29, flows:29, ars:"43.500" },
  { name:"Beat WAV", description:"Formato WAV · alta fidelidad. Para un sonido profesional.", usd:49, flows:49, ars:"73.500" },
  { name:"Beat exclusivo", description:"Producción a medida. 100% tus derechos.", usd:250, flows:250, ars:"375.000" },
  { name:"Mezcla", description:"Claridad, balance y potencia para llevar tus canciones al siguiente nivel.", usd:15, flows:15, ars:"22.500" },
  { name:"Master", description:"Volumen, presencia e impacto. Sonido listo para el mundo.", usd:15, flows:15, ars:"22.500" },
];
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluServicePage data={data} kicker="Estudio profesional" title="PRODUCCIONES" subtitle="BEATS · MEZCLA · MASTER" description="Tu visión, nuestra experiencia. De la idea al mundo." offers={OFFERS} ctaLabel="Agregar" />}
