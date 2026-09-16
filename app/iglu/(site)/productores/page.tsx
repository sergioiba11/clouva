import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";

export const metadata: Metadata = { title: "Productores" };
const OFFERS: IgluOffer[] = [
  { name:"Trap / Drill", description:"Calle · energía · realidad.", usd:60, flows:60, ars:"90.000" },
  { name:"Boom Bap", description:"Samples · historia · esencia.", usd:55, flows:55, ars:"82.500" },
  { name:"Reggaetón", description:"Ritmo · flow · conexión.", usd:65, flows:65, ars:"97.500" },
  { name:"Cumbia urbana", description:"Tradición · fusión · barrio.", usd:50, flows:50, ars:"75.000" },
  { name:"Sound Design", description:"Texturas · atmósferas · innovación.", usd:80, flows:80, ars:"120.000" },
];
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluServicePage data={data} kicker="Beats que cruzan fronteras" title="PRODUCTORES" subtitle="IDEAS · SONIDO · CULTURA · SIN FRONTERAS" description="Trabajá con productores que entienden tu visión. Diferentes estilos, una misma misión: llevar tu música más lejos." offers={OFFERS} ctaLabel="Ver productor" />}
