"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type SearchResult = {
  id: string;
  kind: "player" | "studio" | "business";
  label: string;
  secondary: string | null;
  imageUrl: string | null;
  href: string;
};

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  );
}

function kindLabel(kind: SearchResult["kind"]) {
  if (kind === "player") return "Player";
  if (kind === "business") return "Negocio";
  return "Estudio";
}

export function ClouvaGlobalSearch() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        window.requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    const handlePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handlePointer);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handlePointer);
    };
  }, []);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search/global?q=${encodeURIComponent(clean)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("search failed");
        const payload = await response.json() as { results?: SearchResult[] };
        setResults(Array.isArray(payload.results) ? payload.results : []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <label
        className="group flex h-[40px] min-w-0 items-center gap-2.5 rounded-[14px] border border-white/[0.08] bg-white/[0.025] px-3 text-white/55 shadow-[inset_0_1px_rgba(255,255,255,.025)] transition focus-within:border-violet-300/25 focus-within:bg-white/[0.04]"
        aria-label="Buscar en CLOUVA"
      >
        <span className="shrink-0 text-white/62"><SearchGlyph /></span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-white outline-none placeholder:text-white/34 sm:text-[13px]"
          placeholder="Buscar Players, Negocios, Estudios..."
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="hidden shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2 py-1 text-[9px] font-medium text-white/30 xl:block">Ctrl + K</kbd>
      </label>

      {open && (query.trim().length >= 2 || loading) ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[90] overflow-hidden rounded-[18px] border border-violet-300/15 bg-[#0a0816]/98 p-2 shadow-[0_24px_70px_rgba(0,0,0,.62),0_0_30px_rgba(124,58,237,.12)] backdrop-blur-2xl">
          <div className="px-2.5 pb-2 pt-1.5 text-[8px] font-bold uppercase tracking-[0.24em] text-white/28">
            Buscar en CLOUVA
          </div>
          {loading ? (
            <div className="rounded-xl px-3 py-4 text-[11px] text-white/38">Buscando…</div>
          ) : results.length ? (
            <div className="grid gap-1">
              {results.map((result) => (
                <Link
                  key={`${result.kind}:${result.id}`}
                  href={result.href}
                  onClick={() => setOpen(false)}
                  className="flex min-w-0 items-center gap-3 rounded-[13px] px-2.5 py-2 transition hover:bg-white/[0.055]"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-violet-500/10 text-[11px] font-bold text-violet-200">
                    {result.imageUrl ? <img src={result.imageUrl} alt="" className="h-full w-full object-cover" /> : result.label.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-white/90">{result.label}</span>
                    <span className="mt-1 block truncate text-[9px] text-white/36">{result.secondary || kindLabel(result.kind)}</span>
                  </span>
                  <span className="rounded-full border border-white/[0.07] px-2 py-1 text-[7px] font-bold uppercase tracking-[0.14em] text-violet-200/65">
                    {kindLabel(result.kind)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl px-3 py-4 text-[11px] text-white/38">No encontramos Players, Negocios o Estudios públicos con ese nombre.</div>
          )}
          <div className="mt-1 border-t border-white/[0.05] px-2.5 py-2 text-[8px] leading-4 text-white/24">
            Busca identidades y espacios públicos de CLOUVA. Los espacios privados nunca aparecen en estos resultados.
          </div>
        </div>
      ) : null}
    </div>
  );
}
