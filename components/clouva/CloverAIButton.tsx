"use client";

import { Clover } from "lucide-react";

type CloverAIButtonProps = {
  open: boolean;
  onClick: () => void;
};

export function CloverAIButton({ open, onClick }: CloverAIButtonProps) {
  return (
    <button
      type="button"
      aria-label={open ? "Cerrar asistente" : "Abrir asistente"}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="clouva-ai-button group"
    >
      <span className="clouva-ai-glass" aria-hidden="true">
        <Clover className="clouva-ai-clover" strokeWidth={1.8} />
        <span className="clouva-ai-spark" />
      </span>
    </button>
  );
}
