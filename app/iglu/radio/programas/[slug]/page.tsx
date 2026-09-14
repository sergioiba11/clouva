import { RadioSectionPage } from "@/components/iglu-radio/RadioSectionPage";

function labelFromSlug(slug: string) {
  return decodeURIComponent(slug).replaceAll("-", " ").trim().toUpperCase() || "PROGRAMA";
}

export default async function IgluRadioProgramPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <RadioSectionPage
      eyebrow="PROGRAMAS / SHOW"
      title={labelFromSlug(slug)}
      description="Vista preparada para portada, host, descripción, próximo horario, episodios y contenido relacionado."
      note="La programación real se conectará sin modificar el motor persistente de IGLÚ RADIO."
    />
  );
}
