export default function IgluRadioLoading() {
  return (
    <section className="iglu-radio-subpage" aria-live="polite" aria-busy="true">
      <span className="iglu-radio-subpage__eyebrow">IGLÚ RADIO / CARGANDO</span>
      <div className="mt-6 h-20 w-[min(620px,90%)] animate-pulse rounded-2xl bg-cyan-100/5" />
      <div className="mt-8 h-40 w-full max-w-3xl animate-pulse rounded-[20px] border border-cyan-100/10 bg-cyan-100/[0.03]" />
      <span className="sr-only">Cargando contenido de IGLÚ RADIO</span>
    </section>
  );
}
