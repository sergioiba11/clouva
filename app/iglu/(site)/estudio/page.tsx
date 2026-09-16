import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IgluStudio } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";

export const metadata: Metadata = { title: "El estudio" };
export default async function Page() { const data = await loadIgluSiteData(); if (!data) notFound(); return <IgluStudio data={data} />; }
