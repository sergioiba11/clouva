import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { studioPublicHref } from "@/lib/public-studio-routes";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Estudio no encontrado — CLOUVA", robots: { index: false, follow: false } };

  const canonical = `${siteUrl}${studioPublicHref(result.canonicalAlias)}`;
  const title = result.studio.seo_title || `${result.studio.name} — Estudio en CLOUVA`;
  const description = result.studio.seo_description || result.studio.description || result.studio.tagline || undefined;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: false, follow: true },
  };
}

export default async function LegacyStudioProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();

  permanentRedirect(`${studioPublicHref(result.canonicalAlias)}${query.joined === "1" ? "?joined=1" : ""}`);
}
