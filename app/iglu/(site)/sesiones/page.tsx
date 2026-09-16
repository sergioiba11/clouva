import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
export const metadata: Metadata = { title: "Sesiones" };
const OFFERS:IgluOffer[]=[
{name:"IGLÚ Session Solo",description:"Tu momento. Tu música. Nuestro estudio.",usd:90,flows:90,ars:"135.000"},
{name:"Cypher Slot",description:"Voces que se encuentran. Cultura que crece.",usd:35,flows:35,ars:"52.500"},
{name:"Live Video Take",description:"Tu performance en alta definición.",usd:120,flows:120,ars:"180.000"},
{name:"Acoustic Set",description:"La esencia. Sin filtros.",usd:70,flows:70,ars:"105.000"},
{name:"Backstage Interview",description:"Historias que inspiran. Más allá de la música.",usd:25,flows:25,ars:"37.500"},
];
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluServicePage data={data} kicker="IGLÚ Records" title="SESIONES" subtitle="SESIONES EN VIVO · CYPHERS · ACÚSTICOS · PERFORMANCE" description="La música también habita en lugares fríos. Grabá, compartí, conectá." offers={OFFERS} />}
