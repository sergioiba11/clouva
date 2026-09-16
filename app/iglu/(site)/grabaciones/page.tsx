import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";

export const metadata: Metadata = { title: "Grabaciones" };
const OFFERS: IgluOffer[] = [
  { name: "1 hora vocal", description: "Grabación profesional de voces en estudio.", usd: 15, flows: 15, ars: "22.500" },
  { name: "4 horas estudio", description: "Más tiempo para tu creatividad.", usd: 50, flows: 50, ars: "75.000" },
  { name: "Jornada 6 hs", description: "La sesión completa para llevar tu proyecto al siguiente nivel.", usd: 70, flows: 70, ars: "105.000" },
  { name: "Canción completa", description: "Voces principales, coros, dobles y edición básica.", usd: 95, flows: 95, ars: "142.500" },
  { name: "Coros y dobles", description: "Sumá profundidad y fuerza a tus temas.", usd: 25, flows: 25, ars: "37.500" },
];
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluServicePage data={data} kicker="Estudio profesional" title="GRABACIONES" subtitle="VOCES · TOMAS · COROS · GRABACIÓN PROFESIONAL" description="Tu voz, en otro nivel. Grabá en un entorno único con la energía del sur." offers={OFFERS} />}
