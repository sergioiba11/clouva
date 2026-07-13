"use client";

type CloverAIPanelProps = { open: boolean };

export function CloverAIPanel({ open }: CloverAIPanelProps) {
  if (!open) return null;

  return (
    <aside className="clouva-ai-panel" onClick={(event) => event.stopPropagation()}>
      <p className="text-xs uppercase tracking-[0.28em] text-emerald-200/60">Clover AI</p>
      <h2 className="mt-2 text-lg font-semibold text-white">Clover AI</h2>
      <p className="mt-2 text-sm leading-6 text-white/68">Hola. Voy a ayudarte a crear tu personaje.</p>
      <button type="button" className="mt-4 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-50 shadow-[0_0_24px_rgba(16,185,129,0.14)] transition hover:bg-emerald-300/15">
        Crear mi personaje
      </button>
    </aside>
  );
}
