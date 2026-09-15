import { notFound } from "next/navigation";
import { RadioAdminApp } from "@/components/iglu-radio/RadioAdminApp";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";

type RadioAdminSection = "overview" | "library" | "playlists" | "schedule" | "infra";
const VALID_SECTIONS = new Set<RadioAdminSection>(["overview", "library", "playlists", "schedule", "infra"]);

export default async function IgluRadioAdminPage({
  params,
}: {
  params: Promise<{ slug: string; section?: string[] }>;
}) {
  const { slug, section = [] } = await params;
  if (slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  if (section.length > 1) notFound();

  const candidate = (section[0] ?? "overview") as RadioAdminSection;
  if (!VALID_SECTIONS.has(candidate)) notFound();

  return <RadioAdminApp initialSection={candidate} />;
}
