"use client";

import Link from "next/link";

const options = ["Desde una selfie", "Desde varias fotos", "Describiéndolo", "Desde tu Spotify", "Sorprendeme"];

type CloverAIPanelProps = { open: boolean; onClose: () => void };

export function CloverAIPanel({ open, onClose }: CloverAIPanelProps) {
  if (!open) return null;

  return (
    <aside className="clouva-ai-panel" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Cerrar Clover AI" className="clouva-ai-close" onClick={onClose}>×</button>
      <h2>Clover AI</h2>
      <p>Hola, soy Clover.<br />Voy a ayudarte a crear tu identidad.</p>
      <div className="clouva-ai-options">{options.map((option) => <button type="button" key={option}>{option}</button>)}</div>
      <Link href="/mi-flow/avatar" className="clouva-ai-primary">Crear mi personaje</Link>
    </aside>
  );
}
