"use client";

import Link from "next/link";

type CloverAIPanelProps = { open: boolean; onClose: () => void };

export function CloverAIPanel({ open, onClose }: CloverAIPanelProps) {
  if (!open) return null;

  return (
    <aside className="clouva-ai-panel" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Cerrar Clover AI" className="clouva-ai-close" onClick={onClose}>×</button>
      <h2>Clover AI</h2>
      <p>Hola, soy Clover.<br />Voy a ayudarte a crear tu identidad.</p>
      <div className="clouva-ai-options">
        <Link href="/mi-flow/avatar-ia" className="clouva-ai-primary" onClick={onClose}>
          Crear mi personaje con IA
        </Link>
        <Link href="/mi-flow/avatar" className="clouva-ai-secondary" onClick={onClose}>
          Ver mis avatares
        </Link>
      </div>
    </aside>
  );
}
