import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StudioPublicView } from "@/components/public/StudioPublicView";
import { StudioLayoutRenderer } from "@/components/public/StudioLayoutRenderer";
import { PreciseStudioLayoutRenderer } from "@/components/public/PreciseStudioLayoutRenderer";
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

export default async function StudioProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) {
    redirect(`/studios/${result.canonicalAlias}${query.joined === "1" ? "?joined=1" : ""}`);
  }

  // layout_config solo existe (no vacío) cuando el Estudio corrió CLOUVA AI
  // Profile con un mockup replicado o eligió una variante de diseño -- todos
  // los demás siguen con la plantilla fija de siempre, sin ningún cambio.
  // "precise" (pixel por pixel del mockup subido) es un esquema paralelo,
  // nuevo, que usa su propio renderer -- las páginas ya publicadas con el
  // esquema viejo (layout_kind "template") siguen exactamente igual.
  if (result.layoutConfig?.layout_kind === "precise") {
    return (
      <PreciseStudioLayoutRenderer
        studio={result.studio}
        players={result.players}
        media={result.media}
        projects={result.projects as Array<Record<string, unknown>>}
        matrixDiscoveryProjects={result.matrixDiscoveryProjects as Array<Record<string, unknown>>}
        services={result.services}
        membershipPlans={result.membershipPlans}
        joined={query.joined === "1"}
        layout={result.layoutConfig}
      />
    );
  }

  if (result.layoutConfig) {
    return (
      <StudioLayoutRenderer
        studio={result.studio}
        players={result.players}
        media={result.media}
        projects={result.projects as Array<Record<string, unknown>>}
        matrixDiscoveryProjects={result.matrixDiscoveryProjects as Array<Record<string, unknown>>}
        services={result.services}
        membershipPlans={result.membershipPlans}
        joined={query.joined === "1"}
        layout={result.layoutConfig}
      />
    );
  }

  return (
    <StudioPublicView
      studio={result.studio}
      players={result.players}
      media={result.media}
      projects={result.projects as Array<Record<string, unknown>>}
      services={result.services}
      membershipPlans={result.membershipPlans}
      joined={query.joined === "1"}
    />
  );
}
