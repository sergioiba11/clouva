import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VidaDeFlowsExperience } from "@/components/vida-de-flows/VidaDeFlowsExperience";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

const PROJECT_ALIAS = "clouva";
const CANONICAL_URL = "https://clouva.com.ar/vidadeflows";

export async function generateMetadata(): Promise<Metadata> {
  const playerResult = await resolvePlayerAlias(PROJECT_ALIAS).catch(() => null);

  const image =
    playerResult?.player.og_image_url ||
    playerResult?.player.hero_image_url ||
    playerResult?.player.cover_url ||
    playerResult?.player.profile_image_url ||
    undefined;

  return {
    title: "Vida de Flows — Clouva",
    description:
      "Vida de Flows, una experiencia visual de Clouva dentro de CLOUVA.",
    alternates: { canonical: CANONICAL_URL },
    openGraph: {
      type: "website",
      siteName: "CLOUVA",
      locale: "es_AR",
      url: CANONICAL_URL,
      title: "Vida de Flows — Clouva",
      description:
        "Vida de Flows, una experiencia visual de Clouva dentro de CLOUVA.",
      images: image ? [{ url: image, alt: "Vida de Flows — Clouva" }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: "Vida de Flows — Clouva",
      description:
        "Vida de Flows, una experiencia visual de Clouva dentro de CLOUVA.",
      images: image ? [image] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function VidaDeFlowsPage() {
  const playerResult = await resolvePlayerAlias(PROJECT_ALIAS).catch(() => null);
  if (!playerResult) notFound();

  const player = playerResult.player;

  return (
    <VidaDeFlowsExperience
      alias={playerResult.canonicalAlias}
      displayName={player.display_name}
      profileImageUrl={player.profile_image_url}
      heroImageUrl={player.hero_image_url || player.cover_url}
      spotifyUrl={player.spotify_profile_url}
      youtubeUrl={player.youtube_channel_url}
    />
  );
}
