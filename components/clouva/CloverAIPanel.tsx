"use client";

import Link from "next/link";
import { useState } from "react";
import { generateAvatarConfig } from "@/lib/avatar-engine/catalog";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";

const options = [
  { label: "Desde una selfie", prompt: "estilo real desde selfie" },
  { label: "Estilo oscuro", prompt: "oscuro" },
  { label: "Estilo violeta", prompt: "violeta" },
  { label: "Sorprendeme", prompt: "oscuro violeta hoodie baggy" },
];

type CloverAIPanelProps = { open: boolean; onClose: () => void };

export function CloverAIPanel({ open, onClose }: CloverAIPanelProps) {
  const config = useAvatarStore((state) => state.config);
  const applyConfig = useAvatarStore((state) => state.applyConfig);
  const [busy, setBusy] = useState<string | null>(null);

  if (!open) return null;

  const handleOption = (label: string, prompt: string) => {
    setBusy(label);
    const next = generateAvatarConfig(prompt, config);
    applyConfig(next, `Clover ajustó tu look: "${label}"`);
    setTimeout(() => setBusy(null), 400);
  };

  return (
    <aside className="clouva-ai-panel" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Cerrar Clover AI" className="clouva-ai-close" onClick={onClose}>×</button>
      <h2>Clover AI</h2>
      <p>Hola, soy Clover.<br />Voy a ayudarte a crear tu identidad.</p>
      <div className="clouva-ai-options">
        {options.map((option) => (
          <button type="button" key={option.label} onClick={() => handleOption(option.label, option.prompt)} disabled={busy === option.label}>
            {busy === option.label ? "Aplicando..." : option.label}
          </button>
        ))}
      </div>
      <Link href="/mi-flow/avatar" className="clouva-ai-primary">Crear mi personaje</Link>
    </aside>
  );
}
