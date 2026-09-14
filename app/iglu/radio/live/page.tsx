import { RadioSectionPage } from "@/components/iglu-radio/RadioSectionPage";

export default function IgluRadioLivePage() {
  return (
    <RadioSectionPage
      eyebrow="00 / LIVE"
      title="EN VIVO"
      description="La señal principal de IGLÚ RADIO vive en el reproductor persistente y continúa aunque recorras el resto de la radio."
      note="El estado LIVE solo aparece cuando el elemento de audio confirma reproducción real."
    />
  );
}
