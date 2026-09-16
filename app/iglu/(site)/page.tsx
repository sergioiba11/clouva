import { notFound } from "next/navigation";
import { IgluHome } from "@/components/iglu/IgluPages";
import { loadIgluSiteData } from "@/lib/iglu/site-data";

export default async function IgluHomePage() {
  const data = await loadIgluSiteData();
  if (!data) notFound();
  return <IgluHome data={data} />;
}
