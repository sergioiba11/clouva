"use client";

import { useState } from "react";

export function PublicShareButton({ title, className = "" }: { title: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={() => void share()}
      className={`rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm font-medium text-white transition hover:border-violet-400/60 ${className}`}
    >
      {copied ? "Enlace copiado" : "Compartir"}
    </button>
  );
}
