import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { JoinStudioForm } from "@/components/studios/JoinStudioForm";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Estudio no encontrado — CLOUVA", robots: { index: false, follow: false } };
  return {
    title: `Quiero unirme a ${result.publicStudio.publicName} — CLOUVA`,
    description: `Presentá tu identidad para formar parte de ${result.publicStudio.publicName}.`,
    robots: { index: false, follow: true },
  };
}

export default async function MatrixJoinStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();
  if (slug.toLowerCase() !== result.canonicalAlias.toLowerCase()) permanentRedirect(`${result.publicStudio.href}/join`);
  const logo = result.publicStudio.logoUrl || result.studio.logo_url;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05040a] px-4 py-8 text-white sm:py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(124,58,237,.25),transparent_40%)]" />
      <div className="relative mx-auto max-w-2xl">
        <Link href={result.publicStudio.href} className="text-sm text-white/45 transition hover:text-white">← Volver a {result.publicStudio.publicName}</Link>
        <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#0b0913]/90 p-5 shadow-2xl backdrop-blur-xl sm:p-8">
          <div className="flex items-center gap-4">
            {logo ? <img src={logo} alt={result.publicStudio.publicName} className="h-16 w-16 rounded-2xl object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15 text-2xl font-semibold">{result.publicStudio.publicName.charAt(0)}</div>}
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Solicitud de ingreso</p>
              <h1 className="mt-1 text-3xl font-bold">Quiero unirme a {result.publicStudio.publicName}</h1>
            </div>
          </div>
          <p className="mt-5 leading-7 text-white/55">Completá tus datos para que el equipo del Estudio pueda conocer tu identidad, tu trabajo y el motivo de tu solicitud.</p>
          <div className="mt-7"><JoinStudioForm slug={result.canonicalAlias} studioName={result.publicStudio.publicName} /></div>
        </section>
      </div>
    </main>
  );
}
