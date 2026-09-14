import { RadioSectionPage } from "@/components/iglu-radio/RadioSectionPage";

function labelFromSlug(slug: string) {
  return decodeURIComponent(slug).replaceAll("-", " ").trim().toUpperCase() || "SESIÓN";
}

export default async function IgluRadioSessionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <RadioSectionPage
      eyebrow="IGLÚ SESSIONS / ARCHIVO"
      title={labelFromSlug(slug)}
      description="Vista preparada para audio o video, artista, duración, fecha, tags y descripción de una sesión real."
      note="Esta ruta no fabrica media ni metadata mientras el archivo editorial no esté conectado."
    />
  );
}
