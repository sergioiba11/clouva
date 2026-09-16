import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluArtists } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";
export const metadata: Metadata = { title: "Artistas / Player" };
export default async function Page(){const data=await loadIgluSiteData();if(!data)notFound();return <IgluArtists data={data} />}
