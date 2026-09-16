import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  const canonical = result ? `${siteUrl}${result.publicStudio.href}/agenda` : undefined;
  return { title: "Agenda — CLOUVA", alternates: canonical ? { canonical } : undefined, robots: { index: false, follow: true } };
}

export default async function LegacyStudioAgendaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  permanentRedirect(`${result.publicStudio.href}/agenda`);
}
