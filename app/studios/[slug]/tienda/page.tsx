import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function LegacyStudioStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  permanentRedirect(`${result.publicStudio.href}/tienda`);
}
