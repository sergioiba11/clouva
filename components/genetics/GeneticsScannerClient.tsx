"use client";

import Link from "next/link";
import { Camera, Check, ChevronRight, Leaf, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { loadStrains } from "@/lib/genetics/client";
import { analyzeVisualSimilarity } from "@/lib/genetics/visual-analysis";
import { supabase } from "@/lib/supabase";
import type { ScanAnalysis, Strain } from "@/lib/genetics/types";
import styles from "./genetics.module.css";

export function GeneticsScannerClient() {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [strains, setStrains] = useState<Strain[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ScanAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadStrains().then((next) => { if (alive) setStrains(next); });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const selectFile = (next: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    setAnalysis(null);
    setError(null);
  };

  const analyze = async () => {
    if (!file) {
      inputRef.current?.click();
      return;
    }
    if (!strains.length) {
      setError("Todavía no hay fichas disponibles para comparar.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await analyzeVisualSimilarity(file, strains);
      setAnalysis(result);
      if (user) {
        const { error: saveError } = await supabase.from("strain_scans").insert({
          user_id: user.id,
          image_url: null,
          analysis: result,
        });
        if (saveError) throw saveError;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo analizar la imagen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <span className={styles.eyebrow}>ANÁLISIS VISUAL</span>
        <h1>Escanear</h1>
        <p>Comparamos color, luminosidad y textura contra las imágenes del catálogo. El resultado es similitud visual: no confirma una genética.</p>
      </section>

      <section className={styles.scannerPanel}>
        <div className={styles.scannerViewport}>
          {preview ? (
            <img src={preview} alt="Imagen seleccionada para análisis" />
          ) : (
            <div className={styles.scannerPlaceholder}>
              <Leaf size={58} strokeWidth={1.1} />
              <span>Alineá la flor dentro del marco</span>
            </div>
          )}
          <i className={styles.cornerOne} /><i className={styles.cornerTwo} /><i className={styles.cornerThree} /><i className={styles.cornerFour} />
          {loading ? <span className={styles.scanLine} aria-hidden="true" /> : null}
        </div>

        <input
          ref={inputRef}
          className={styles.hiddenInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(event) => selectFile(event.target.files?.[0] || null)}
        />

        <div className={styles.scannerActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()}>
            <Upload size={17} /> {file ? "CAMBIAR IMAGEN" : "SUBIR IMAGEN"}
          </button>
          <button type="button" className={styles.primaryButton} onClick={analyze} disabled={loading}>
            {loading ? <LoaderCircle className={styles.spin} size={18} /> : <Camera size={18} />}
            {loading ? "ANALIZANDO…" : "ANALIZAR"}
          </button>
        </div>

        {!user ? <p className={styles.inlineNotice}>El análisis funciona localmente. <Link href="/login">Iniciá sesión</Link> si querés guardar el historial.</p> : null}
        {error ? <p className={styles.errorMessage}>{error}</p> : null}
      </section>

      {analysis ? (
        <section className={styles.resultsPanel}>
          <div className={styles.sectionTitle}><div><span>RESULTADO</span><h2>Coincidencias visuales</h2></div></div>
          {analysis.visualMatches.length ? analysis.visualMatches.map((match) => (
            <Link key={match.slug} href={`/geneticas/${encodeURIComponent(match.slug)}`} className={styles.matchCard}>
              <div><strong>{match.name}</strong><span>{match.similarity == null ? "Similitud cualitativa" : `${match.similarity}% de similitud visual`}</span></div>
              <ChevronRight size={19} />
            </Link>
          )) : <p className={styles.bodyCopy}>No encontramos referencias visuales comparables en el catálogo actual.</p>}

          <div className={styles.sectionTitle}><div><h2>Características detectadas</h2></div></div>
          <div className={styles.characteristics}>
            {analysis.visibleCharacteristics.map((item) => <span key={item}><Check size={15} />{item}</span>)}
          </div>
          <p className={styles.resultNote}>{analysis.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
