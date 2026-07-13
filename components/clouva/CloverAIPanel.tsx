"use client";

import Link from "next/link";

type CloverAIPanelProps = { open: boolean; onClose: () => void };

export function CloverAIPanel({ open, onClose }: CloverAIPanelProps) {
  if (!open) return null;

  return (
    <aside className="clouva-ai-panel" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Cerrar Clover AI" className="clouva-ai-close" onClick={onClose}>×</button>
      <p className="text-[11px] uppercase tracking-[0.26em] text-[#c4b5fd]/70">Clover AI</p>
      <h2 className="mt-1 text-base font-semibold text-[#f5f3ff]">Clover AI</h2>
      <p className="mt-2 text-sm leading-5 text-[#f5f3ff]/72">Voy a ayudarte a crear tu personaje.</p>
      <Link href="/mi-flow/avatar" className="mt-4 inline-flex rounded-full border border-[#8b5cf6]/35 bg-[#7c3aed]/18 px-4 py-2 text-sm text-[#f5f3ff] shadow-[0_0_24px_rgba(139,92,246,0.16)] transition hover:bg-[#7c3aed]/28">
        Crear mi personaje
      </Link>
    </aside>
  );
}
