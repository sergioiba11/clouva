import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function LegacyStudioProductPage({ params }: { params: Promise<{ slug: string; productSlug: string }> }) {
  const { slug, productSlug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  permanentRedirect(`${result.publicStudio.href}/tienda/${encodeURIComponent(productSlug)}`);
}
