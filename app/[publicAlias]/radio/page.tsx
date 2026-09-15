import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileRadioHome } from "@/components/radio/ProfileRadioHome";
import { resolvePublicProfileRadio } from "@/lib/server/profile-radio-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicAlias: string }> }): Promise<Metadata> {
  const { publicAlias } = await params;
  const station = await resolvePublicProfileRadio(publicAlias).catch(() => null);
  if (!station) return { title: "Radio no disponible — CLOUVA", robots: { index: false, follow: false } };

  const title = `${station.name} Radio — CLOUVA`;
  const description = station.tagline || `Escuchá ${station.name} Radio en CLOUVA.`;
  const canonical = `https://clouva.com.ar/${station.alias}/radio`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description,
      images: station.artworkUrl ? [{ url: station.artworkUrl }] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function PublicProfileRadioPage({ params }: { params: Promise<{ publicAlias: string }> }) {
  const { publicAlias } = await params;
  const station = await resolvePublicProfileRadio(publicAlias).catch(() => null);
  if (!station) notFound();

  return <ProfileRadioHome />;
}
