import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StudioPublicView } from "@/components/public/StudioPublicView";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Estudio no encontrado — CLOUVA", robots: { index: false, follow: false } };
  const canonical = `https://clouva.com.ar/studios/${result.canonicalAlias}`;
  const title = `${result.studio.name} — Estudio`;
  const description = result.studio.description || result.studio.tagline || undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description,
      images: result.studio.cover_url ? [{ url: result.studio.cover_url }] : undefined,
    },
  };
}

export default async function StudioProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) {
    redirect(`/studios/${result.canonicalAlias}`);
  }

  return (
    <StudioPublicView
      studio={result.studio}
      players={result.players}
      media={result.media}
      projects={result.projects as Array<Record<string, unknown>>}
    />
  );
}
