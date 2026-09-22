import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { VidaDeFlowsExperience } from "@/components/vida-de-flows/VidaDeFlowsExperience";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

const PROJECT_ALIAS = "clouva";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicAlias: string }>;
}): Promise<Metadata> {
  const { publicAlias } = await params;
  const playerResult = await resolvePlayerAlias(publicAlias).catch(() => null);

  if (!playerResult || playerResult.canonicalAlias.toLowerCase() !== PROJECT_ALIAS) {
    return {
      title: "Vida de Flows — CLOUVA",
      robots: { index: false, follow: false },
    };
  }

  const canonical = `https://clouva.com.ar/${playerResult.canonicalAlias}/vidadeflows`;
  const image =
    playerResult.player.og_image_url ||
    playerResult.player.hero_image_url ||
    playerResult.player.cover_url ||
    playerResult.player.profile_image_url ||
    undefined;

  return {
    title: "Vida de Flows — Clouva",
    description:
      "Vida de Flows, una experiencia visual de Clouva dentro de CLOUVA.",
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: "CLOUVA",
      locale: "es_AR",
      url: canonical,
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

export default async function VidaDeFlowsPage({
  params,
}: {
  params: Promise<{ publicAlias: string }>;
}) {
  const { publicAlias } = await params;
  const playerResult = await resolvePlayerAlias(publicAlias).catch(() => null);

  if (!playerResult) notFound();

  if (publicAlias.toLowerCase() !== playerResult.canonicalAlias.toLowerCase()) {
    redirect(`/${playerResult.canonicalAlias}/vidadeflows`);
  }

  if (playerResult.canonicalAlias.toLowerCase() !== PROJECT_ALIAS) {
    notFound();
  }

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
