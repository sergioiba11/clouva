import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluAbout } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
export const metadata: Metadata = { title: "Nosotros" };
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluAbout data={data} />}
