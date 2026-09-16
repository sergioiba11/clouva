import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluMemberships, type IgluOffer } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
export const metadata: Metadata = { title: "Membresías" };
const FALLBACK:IgluOffer[]=[
{name:"Ice Pass",description:"Acceso al estudio online · tracks · comunidad IGLÚ.",usd:19,flows:19,ars:"28.500"},
{name:"Fresh Artist",description:"Grabaciones profesionales · beats exclusivos · feedback.",usd:49,flows:49,ars:"73.500"},
{name:"Norte Pro",description:"Grabación, mezcla y master · beats premium · soporte prioritario.",usd:99,flows:99,ars:"148.500",badge:"Más elegida"},
{name:"Glacier Pro",description:"Producción avanzada · colaboraciones · asesoramiento personalizado.",usd:149,flows:149,ars:"223.500"},
{name:"Label Circle",description:"Acompañamiento A&R · distribución digital · eventos exclusivos.",usd:249,flows:249,ars:"373.500"},
];
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluMemberships data={data} fallback={FALLBACK} />}
