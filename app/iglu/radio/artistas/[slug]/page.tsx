import { RadioSectionPage } from "@/components/iglu-radio/RadioSectionPage";

function labelFromSlug(slug: string) {
  return decodeURIComponent(slug).replaceAll("-", " ").trim().toUpperCase() || "ARTISTA";
}

export default async function IgluRadioArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <RadioSectionPage
      eyebrow="ARTIST SPOTLIGHT / PERFIL"
      title={labelFromSlug(slug)}
      description="Perfil editorial preparado para bio, sesiones, tracks y contenido relacionado cuando exista una fuente real para este artista."
      note="No se inventaron datos de artista para completar esta vista."
    />
  );
}
