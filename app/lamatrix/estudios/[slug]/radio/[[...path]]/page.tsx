import { notFound, permanentRedirect } from "next/navigation";
import { RadioHome } from "@/components/iglu-radio/RadioHome";
import { RadioSearch } from "@/components/iglu-radio/RadioSearch";
import { RadioSectionPage } from "@/components/iglu-radio/RadioSectionPage";
import { IGLU_STUDIO_SLUG, igluRadioRoute } from "@/lib/iglu-radio/routes";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

const RADIO_SECTIONS: Record<string, { eyebrow: string; title: string; description: string; note: string }> = {
  artistas: { eyebrow: "02 / ARTIST SPOTLIGHT", title: "ARTISTAS", description: "Las voces, identidades y escenas que pasan por IGLÚ, conectadas desde el Sur hacia afuera.", note: "Los perfiles reales se publicarán desde la fuente editorial de IGLÚ." },
  sesiones: { eyebrow: "03 / IGLÚ SESSIONS", title: "SESIONES", description: "Live sessions, freestyles, entrevistas, DJ sets y momentos de estudio pensados como archivo cultural.", note: "El catálogo de sesiones todavía no fue publicado." },
  programas: { eyebrow: "04 / PROGRAMAS", title: "PROGRAMAS", description: "Shows, entrevistas y espacios editoriales para que IGLÚ RADIO sea más que una señal continua.", note: "Los programas aparecerán cuando exista una grilla editorial real." },
  schedule: { eyebrow: "05 / SCHEDULE", title: "PROGRAMACIÓN", description: "Hoy, mañana y la semana de IGLÚ RADIO, preparada para estados LIVE, UP NEXT, SCHEDULED y ENDED basados en datos reales.", note: "Aún no hay una grilla publicada; por eso no mostramos horarios ficticios." },
  playlist: { eyebrow: "06 / SELECCIONES", title: "PLAYLIST", description: "Selecciones radiales con criterio IGLÚ: música, escena y cultura, sin convertir la experiencia en un clon de Spotify.", note: "Las selecciones reales se publicarán cuando el catálogo editorial esté conectado." },
  live: { eyebrow: "00 / LIVE", title: "EN VIVO", description: "La señal principal de IGLÚ RADIO vive en el reproductor persistente y continúa aunque recorras el resto de la radio.", note: "El estado LIVE solo aparece cuando el elemento de audio confirma reproducción real." },
};

function artistLabel(slug: string) {
  return decodeURIComponent(slug).replaceAll("-", " ").trim().toUpperCase() || "ARTISTA";
}

export default async function MatrixIgluStudioRadioRoute({ params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path = [] } = await params;
  const studio = await resolveStudioAlias(slug);
  if (!studio || studio.studio.slug.toLowerCase() !== IGLU_STUDIO_SLUG) notFound();
  if (slug.toLowerCase() !== studio.canonicalAlias.toLowerCase()) permanentRedirect(igluRadioRoute(path.join("/")));

  if (path.length === 0) return <RadioHome />;
  if (path.length === 1 && path[0] === "search") return <RadioSearch />;
  if (path.length === 2 && path[0] === "artistas") {
    return <RadioSectionPage eyebrow="ARTIST SPOTLIGHT / PERFIL" title={artistLabel(path[1])} description="Perfil editorial preparado para bio, sesiones, tracks y contenido relacionado cuando exista una fuente real para este artista." note="No se inventaron datos de artista para completar esta vista." />;
  }
  const section = path.length === 1 ? RADIO_SECTIONS[path[0]] : undefined;
  if (!section) notFound();
  return <RadioSectionPage {...section} />;
}
