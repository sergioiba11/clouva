"use client";

import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";

export default function IgluRadioSearchPage() {
  const [query, setQuery] = useState("");
  return (
    <section className="iglu-radio-subpage">
      <Link href="/iglu/radio" className="iglu-radio-back"><ArrowLeft size={16} /> RADIO</Link>
      <span className="iglu-radio-subpage__eyebrow">07 / SEARCH</span>
      <h1>BUSCAR</h1>
      <p className="iglu-radio-subpage__lead">Una entrada rápida para artistas, sesiones, programas y playlists cuando el catálogo real quede conectado.</p>
      <label className="iglu-radio-searchbox">
        <Search size={20} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en IGLÚ RADIO" autoComplete="off" />
      </label>
      <div className="iglu-radio-subpage__panel" aria-live="polite">
        <span>CATÁLOGO</span>
        <strong>{query ? `Sin resultados publicados para “${query}”` : "La búsqueda está preparada."}</strong>
        <p>No mostramos resultados inventados. Esta vista queda desacoplada para conectarse luego a Supabase o al índice editorial que use IGLÚ.</p>
      </div>
    </section>
  );
}
