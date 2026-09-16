import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluServicePage, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
export const metadata: Metadata = { title: "Pagos únicos" };
const OFFERS:IgluOffer[]=[
{name:"Demo Review",description:"Escucha profesional y feedback detallado de tu demo.",usd:10,flows:10,ars:"15.000"},
{name:"Cover Art",description:"Diseño de portada profesional para tu lanzamiento.",usd:35,flows:35,ars:"52.500"},
{name:"Distribución single",description:"Distribuí tu música en las plataformas principales.",usd:25,flows:25,ars:"37.500"},
{name:"Upload DSP Pack",description:"Subimos tu lanzamiento a las plataformas.",usd:20,flows:20,ars:"30.000"},
{name:"Promo Boost",description:"Impulsá tu lanzamiento con promoción estratégica.",usd:45,flows:45,ars:"67.500"},
];
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluServicePage data={data} kicker="Servicios profesionales" title="PAGOS ÚNICOS" subtitle="HERRAMIENTAS REALES PARA TU MÚSICA" description="Servicios puntuales, sin membresía. Calidad profesional, resultados reales y el respaldo de IGLÚ Records." offers={OFFERS} ctaLabel="Agregar al carrito" />}
