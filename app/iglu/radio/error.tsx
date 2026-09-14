"use client";

import { RotateCcw } from "lucide-react";

export default function IgluRadioError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="iglu-radio-subpage" role="alert">
      <span className="iglu-radio-subpage__eyebrow">IGLÚ RADIO / ERROR AISLADO</span>
      <h1>LA RADIO SIGUE.</h1>
      <p className="iglu-radio-subpage__lead">Una parte del contenido no pudo cargar. El motor de audio y el player persistente quedan fuera de este boundary.</p>
      <button type="button" className="iglu-radio-secondary-cta mt-8" onClick={reset}>
        <RotateCcw size={17} /> REINTENTAR CONTENIDO
      </button>
    </section>
  );
}
