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
      aria-label={open ? "Cerrar Clover AI" : "Abrir Clover AI"}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="clouva-ai-button group"
    >
      <span className="clouva-eye" aria-hidden="true">
        <span />
      </span>
      <Clover aria-hidden="true" className="h-3.5 w-3.5 text-emerald-300/85 drop-shadow-[0_0_8px_rgba(74,222,128,0.45)]" />
    </button>
  );
}
