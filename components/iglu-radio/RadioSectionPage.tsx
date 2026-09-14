import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { IGLU_RADIO_PATH } from "@/lib/iglu-radio/routes";

export function RadioSectionPage({
  eyebrow,
  title,
  description,
  note,
}: {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
}) {
  return (
    <section className="iglu-radio-subpage">
      <Link href={IGLU_RADIO_PATH} className="iglu-radio-back"><ArrowLeft size={16} /> RADIO</Link>
      <span className="iglu-radio-subpage__eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p className="iglu-radio-subpage__lead">{description}</p>
      <div className="iglu-radio-subpage__panel">
        <span>IGLÚ RADIO</span>
        <strong>{note}</strong>
        <p>La sección ya vive dentro de la shell persistente de la radio. Al conectar contenido real, esta vista puede hidratarse desde Supabase o la fuente editorial correspondiente sin tocar el motor de audio.</p>
        <Link href={IGLU_RADIO_PATH} className="iglu-radio-inline-link">VOLVER A LA SEÑAL <ArrowRight size={15} /></Link>
      </div>
    </section>
  );
}
