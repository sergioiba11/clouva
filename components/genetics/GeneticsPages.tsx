"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Dna,
  FlaskConical,
  Heart,
  ImagePlus,
  Leaf,
  LoaderCircle,
  Search,
  Sparkles,
  Upload,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { StrainCard } from "@/components/genetics/StrainCard";
import { StrainEffectsWheel } from "@/components/genetics/StrainEffectsWheel";
import { LEARN_TOPICS, PINA_EXPRESS_DEMO } from "@/lib/genetics/demo-data";
import {
  loadFavoriteIds,
  loadProfileGenetics,
  loadStrain,
  loadStrains,
  registerStrainView,
  setFavorite,
} from "@/lib/genetics/client";
import type { ScanAnalysis, Strain } from "@/lib/genetics/types";
import styles from "./genetics.module.css";

const PROFILE_FILTERS = ["Todos", "Creatividad", "Relajación", "Energía", "Concentración", "Chill"] as const;

function HeroArtwork({ strain = PINA_EXPRESS_DEMO }: { strain?: Strain }) {
  return (
    <div className={styles.heroArtwork}>
      {strain.hero_image ? (
        <img src={strain.hero_image} alt={`Vista macro de ${strain.name}`} />
      ) : (
        <div className={styles.botanicalFallback} aria-hidden="true">
          <i /><i /><i /><i /><span><Leaf size={64} strokeWidth={1.1} /></span>
        </div>
      )}
      <div className={styles.heroGlow} aria-hidden="true" />
    </div>
  );
}

function SectionTitle({ eyebrow, title, href }: { eyebrow?: string; title: string; href?: string }) {
  return (
    <div className={styles.sectionTitle}>
      <div>{eyebrow ? <span>{eyebrow}</span> : null}<h2>{title}</h2></div>
      {href ? <Link href={href}>Ver todas <ChevronRight size={15} /></Link> : null}
    </div>
  );
}

function LoadingState({ label = "Preparando genéticas..." }: { label?: string }) {
  return <div className={styles.loadingState}><LoaderCircle className={styles.spin} size={23} /><span>{label}</span></div>;
}

export function GeneticsDiscovery() {
  const { user } = useAuth();
  const [strains, setStrains] = useState<Strain[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<(typeof PROFILE_FILTERS)[number]>("Todos");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadStrains();
      if (!alive) return;
      setStrains(next);
      if (user) {
        try { setFavorites(await loadFavoriteIds(user.id)); } catch { setFavorites(new Set()); }
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const visible = useMemo(() => {
    if (filter === "Todos") return strains;
    const needle = filter.toLowerCase();
    return strains.filter((strain) => {
      const haystack = [...strain.tags, strain.profile || "", strain.subtitle || ""].join(" ").toLowerCase();
      return haystack.includes(needle.replace("concentración", "concentr")) || (filter === "Chill" && haystack.includes("chill"));
    });
  }, [filter, strains]);

  const toggleFavorite = async (strain: Strain) => {
    if (!user || strain.id.startsWith("demo-")) return;
    const next = new Set(favorites);
    const shouldFavorite = !next.has(strain.id);
    shouldFavorite ? next.add(strain.id) : next.delete(strain.id);
    setFavorites(next);
    try { await setFavorite(user.id, strain.id, shouldFavorite); } catch {
      setFavorites(favorites);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.discoveryHero}>
        <HeroArtwork strain={strains[0] || PINA_EXPRESS_DEMO} />
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>PLANTAS · HISTORIAS · PERSONAS</span>
          <h1>Descubrí lo que estás viendo.</h1>
          <p>Explorá genéticas, aromas, perfiles y características visuales.</p>
          <div className={styles.heroButtons}>
            <Link href="/geneticas/escanear" className={styles.primaryButton}><Camera size={18} /> ESCANEAR COGOLLO</Link>
            <Link href="/geneticas/biblioteca" className={styles.secondaryButton}>EXPLORAR GENÉTICAS <ArrowRight size={17} /></Link>
          </div>
        </div>
      </section>

      <section className={styles.contentSection}>
        <SectionTitle eyebrow="CURADO PARA VOS" title="Genéticas destacadas" href="/geneticas/biblioteca" />
        <div className={styles.filterRow} role="list" aria-label="Filtrar por perfil">
          {PROFILE_FILTERS.map((item) => (
            <button key={item} type="button" className={filter === item ? styles.filterActive : undefined} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </div>
        {loading ? <LoadingState /> : (
          <div className={styles.cardGrid}>
            {(visible.length ? visible : strains).slice(0, 6).map((strain) => (
              <StrainCard key={strain.id} strain={strain} favorite={favorites.has(strain.id)} onFavorite={user ? toggleFavorite : undefined} />
            ))}
          </div>
        )}
      </section>

      <section className={styles.editorialStrip}>
        <span><FlaskConical size={19} /> CIENCIA</span>
        <span><Leaf size={19} /> NATURALEZA</span>
        <span><UsersRound size={19} /> COMUNIDAD</span>
      </section>
    </div>
  );
}

export function GeneticsLibrary() {
  const { user } = useAuth();
  const [strains, setStrains] = useState<Strain[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [type, setType] = useState("Todas");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadStrains();
      if (!alive) return;
      setStrains(next);
      if (user) {
        try { setFavorites(await loadFavoriteIds(user.id)); } catch { setFavorites(new Set()); }
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const filtered = useMemo(() => strains.filter((strain) => {
    const q = query.trim().toLowerCase();
    const matchesSearch = !q || [strain.name, strain.subtitle, strain.strain_type, strain.profile, ...strain.tags, ...strain.aromas].filter(Boolean).join(" ").toLowerCase().includes(q);
    const matchesType = type === "Todas" || (strain.strain_type || "").toLowerCase().includes(type.toLowerCase());
    return matchesSearch && matchesType;
  }), [query, strains, type]);

  const toggleFavorite = async (strain: Strain) => {
    if (!user || strain.id.startsWith("demo-")) return;
    const shouldFavorite = !favorites.has(strain.id);
    const next = new Set(favorites);
    shouldFavorite ? next.add(strain.id) : next.delete(strain.id);
    setFavorites(next);
    try { await setFavorite(user.id, strain.id, shouldFavorite); } catch { setFavorites(favorites); }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <span className={styles.eyebrow}>BIBLIOTECA VISUAL</span>
        <h1>Genéticas</h1>
        <p>Buscá por nombre, perfil, aroma o tipo.</p>
      </section>
      <div className={styles.searchBox}><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar genética…" aria-label="Buscar genética" /></div>
      <div className={styles.filterRow}>
        {["Todas", "Híbrida", "Índica", "Sativa"].map((item) => <button key={item} type="button" className={type === item ? styles.filterActive : undefined} onClick={() => setType(item)}>{item}</button>)}
      </div>
      {loading ? <LoadingState /> : filtered.length ? (
        <div className={styles.cardGrid}>{filtered.map((strain) => <StrainCard key={strain.id} strain={strain} favorite={favorites.has(strain.id)} onFavorite={user ? toggleFavorite : undefined} />)}</div>
      ) : <div className={styles.emptyState}><Dna size={30} /><strong>Sin resultados</strong><span>Probá otro nombre, aroma o perfil.</span></div>}
    </div>
  );
}

export function GeneticsScanner() {
  const { user, session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ScanAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const selectFile = (next: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    setAnalysis(null);
    setError(null);
  };

  const analyze = async () => {
    if (!file) { inputRef.current?.click(); return; }
    if (!session?.access_token) { setError("Iniciá sesión para guardar y analizar tu captura."); return; }
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("image", file);
      const response = await fetch("/api/geneticas/analyze", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body });
      const payload = await response.json() as { analysis?: ScanAnalysis; error?: string };
      if (!response.ok || !payload.analysis) throw new Error(payload.error || "No se pudo analizar la imagen.");
      setAnalysis(payload.analysis);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo analizar la imagen.");
    } finally { setLoading(false); }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <span className={styles.eyebrow}>ANÁLISIS VISUAL</span>
        <h1>Escanear</h1>
        <p>Detectamos rasgos visibles y buscamos variedades similares. Una foto no confirma una genética.</p>
      </section>

      <section className={styles.scannerPanel}>
        <div className={styles.scannerViewport}>
          {preview ? <img src={preview} alt="Imagen seleccionada para análisis" /> : <div className={styles.scannerPlaceholder}><Leaf size={58} strokeWidth={1.1} /><span>Alineá el cogollo dentro del marco</span></div>}
          <i className={styles.cornerOne} /><i className={styles.cornerTwo} /><i className={styles.cornerThree} /><i className={styles.cornerFour} />
          {loading ? <span className={styles.scanLine} aria-hidden="true" /> : null}
        </div>
        <input ref={inputRef} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => selectFile(event.target.files?.[0] || null)} />
        <div className={styles.scannerActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()}><Upload size={17} /> {file ? "CAMBIAR IMAGEN" : "SUBIR IMAGEN"}</button>
          <button type="button" className={styles.primaryButton} onClick={analyze} disabled={loading}>{loading ? <LoaderCircle className={styles.spin} size={18} /> : <Camera size={18} />} {loading ? "ANALIZANDO…" : "ANALIZAR"}</button>
        </div>
        {!user ? <p className={styles.inlineNotice}>Para ejecutar y guardar análisis reales, <Link href="/login">iniciá sesión</Link>.</p> : null}
        {error ? <p className={styles.errorMessage}>{error}</p> : null}
      </section>

      {analysis ? (
        <section className={styles.resultsPanel}>
          <SectionTitle eyebrow="RESULTADO" title="Coincidencias visuales" />
          {analysis.visualMatches.length ? analysis.visualMatches.map((match) => (
            <Link key={match.slug} href={`/geneticas/${encodeURIComponent(match.slug)}`} className={styles.matchCard}>
              <div><strong>{match.name}</strong><span>{match.similarity == null ? "Similitud cualitativa" : `${match.similarity}% de similitud visual`}</span></div>
              <ChevronRight size={19} />
            </Link>
          )) : <p className={styles.bodyCopy}>No hay una coincidencia suficientemente clara en el catálogo actual.</p>}

          <SectionTitle title="Características detectadas" />
          <div className={styles.characteristics}>{analysis.visibleCharacteristics.map((item) => <span key={item}><Check size={15} />{item}</span>)}</div>
          {analysis.notes ? <p className={styles.resultNote}>{analysis.notes}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

export function StrainDetail({ slug }: { slug: string }) {
  const { user } = useAuth();
  const [strain, setStrain] = useState<Strain | null>(null);
  const [favorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadStrain(slug);
      if (!alive) return;
      setStrain(next);
      setLoading(false);
      if (next && user && !next.id.startsWith("demo-")) {
        void registerStrainView(user.id, next.id);
        try { setIsFavorite((await loadFavoriteIds(user.id)).has(next.id)); } catch { /* keep false */ }
      }
    })();
    return () => { alive = false; };
  }, [slug, user?.id]);

  if (loading) return <LoadingState label="Abriendo ficha…" />;
  if (!strain) return <div className={styles.emptyState}><Dna size={30} /><strong>Genética no encontrada</strong><Link href="/geneticas/biblioteca">Volver a la biblioteca</Link></div>;

  const toggle = async () => {
    if (!user || strain.id.startsWith("demo-")) return;
    const next = !favorite;
    setIsFavorite(next);
    try { await setFavorite(user.id, strain.id, next); } catch { setIsFavorite(!next); }
  };

  return (
    <article className={styles.page}>
      <section className={styles.strainHero}>
        <HeroArtwork strain={strain} />
        <div className={styles.strainHeroShade} />
        <div className={styles.strainHeroCopy}>
          <span>{strain.tags.join(" · ")}</span>
          <h1>{strain.name}</h1>
          <p>{strain.subtitle || strain.strain_type}</p>
          {user && !strain.id.startsWith("demo-") ? <button type="button" className={styles.saveButton} onClick={toggle}><Heart size={17} fill={favorite ? "currentColor" : "none"} />{favorite ? "Guardada" : "Guardar"}</button> : null}
        </div>
      </section>

      <StrainEffectsWheel effects={strain.effects} />

      <section className={styles.infoGrid}>
        <details className={styles.infoCard}><summary><Leaf size={20} /><span><small>AROMA</small><strong>{strain.aromas.join(", ") || "Sin datos"}</strong></span><ChevronRight size={17} /></summary><p>Perfil aromático registrado para esta ficha.</p></details>
        <details className={styles.infoCard}><summary><FlaskConical size={20} /><span><small>TERPENOS</small><strong>{strain.terpenes.map((item) => item.terpene).join(", ") || "Sin datos"}</strong></span><ChevronRight size={17} /></summary><div className={styles.detailList}>{strain.terpenes.map((item) => <div key={item.terpene}><strong>{item.terpene}</strong><span>{item.description || "Descripción pendiente de fuente verificada."}</span>{item.relative_value != null ? <em>Presencia relativa: {item.relative_value}</em> : null}</div>)}</div></details>
        <details className={styles.infoCard}><summary><Sparkles size={20} /><span><small>PERFIL</small><strong>{strain.profile || "Sin datos"}</strong></span><ChevronRight size={17} /></summary><p>Lectura descriptiva del perfil cargado para esta genética.</p></details>
        <details className={styles.infoCard}><summary><Dna size={20} /><span><small>TIPO</small><strong>{strain.strain_type || "Sin datos"}</strong></span><ChevronRight size={17} /></summary><p>Clasificación informativa de la ficha.</p></details>
      </section>

      <section className={styles.contentSection}>
        <SectionTitle eyebrow="PERFIL SENSORIAL" title="Aromas y sabores" />
        <div className={styles.flavorBars}>{strain.flavors.map((item) => <div key={item.flavor}><span>{item.flavor}</span><i><b style={{ width: `${Math.max(0, Math.min(10, item.value ?? 0)) * 10}%` }} /></i><strong>{item.value == null ? "—" : `${item.value}/10`}</strong></div>)}</div>
      </section>

      <p className={styles.informativeFootnote}>Contenido informativo. Los valores de Piña Express se cargaron como demostración hasta conectarlos a una fuente curada.</p>
    </article>
  );
}

export function GeneticsLearn() {
  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}><span className={styles.eyebrow}>CONOCIMIENTO</span><h1>Aprender</h1><p>Una biblioteca editorial para entender las fichas, su lenguaje y sus fuentes.</p></section>
      <div className={styles.learnGrid}>
        {LEARN_TOPICS.map((topic, index) => <article key={topic.key} className={styles.learnCard}><span>{String(index + 1).padStart(2, "0")}</span><BookOpen size={22} /><h2>{topic.title}</h2><p>{topic.description}</p></article>)}
        <article className={styles.learnCard}><span>06</span><Leaf size={22} /><h2>Cultivo</h2><p>Contexto general, glosario y criterios de lectura; sin convertir la sección en una guía operativa.</p></article>
      </div>
    </div>
  );
}

export function GeneticsCommunity() {
  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}><span className={styles.eyebrow}>PERSONAS</span><h1>Comunidad</h1><p>El espacio visual queda preparado para reviews, fotos, fichas compartidas y conversaciones conectadas a datos reales.</p></section>
      <section className={styles.communityHero}><UsersRound size={34} /><div><strong>Plantas. Historias. Personas.</strong><span>Sin contenido inventado: esta superficie se poblará cuando existan publicaciones de la comunidad.</span></div></section>
      <div className={styles.communitySkeleton} aria-label="Estructura preparada para futuras publicaciones"><i /><i /><i /></div>
    </div>
  );
}

export function GeneticsProfile() {
  const { user, profile } = useAuth();
  const [data, setData] = useState<{ favorites: Strain[]; recent: Strain[]; scans: Array<{ id: string; created_at: string; analysis: ScanAnalysis }> } | null>(null);

  useEffect(() => {
    if (!user) { setData(null); return; }
    let alive = true;
    void loadProfileGenetics(user.id).then((next) => { if (alive) setData(next); }).catch(() => { if (alive) setData({ favorites: [], recent: [], scans: [] }); });
    return () => { alive = false; };
  }, [user?.id]);

  if (!user) return <div className={styles.page}><section className={styles.pageHeader}><span className={styles.eyebrow}>TU BIBLIOTECA</span><h1>Perfil</h1><p>Iniciá sesión para guardar genéticas, ver análisis y recuperar tu historial.</p><Link className={styles.primaryButton} href="/login">INICIAR SESIÓN <ArrowRight size={17} /></Link></section></div>;

  return (
    <div className={styles.page}>
      <section className={styles.profileHero}>
        <div className={styles.profileAvatar}>{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <Leaf size={26} />}</div>
        <div><span className={styles.eyebrow}>TU BIBLIOTECA</span><h1>{profile?.display_name || profile?.full_name || user.email?.split("@")[0] || "Perfil"}</h1><p>Guardadas, vistas y análisis en un mismo lugar.</p></div>
      </section>
      {!data ? <LoadingState /> : (
        <>
          <section className={styles.contentSection}><SectionTitle title="Genéticas guardadas" />{data.favorites.length ? <div className={styles.cardGrid}>{data.favorites.map((strain) => <StrainCard key={strain.id} strain={strain} favorite />)}</div> : <div className={styles.emptyInline}>Todavía no guardaste genéticas.</div>}</section>
          <section className={styles.contentSection}><SectionTitle title="Últimas vistas" />{data.recent.length ? <div className={styles.horizontalCards}>{data.recent.map((strain) => <StrainCard key={strain.id} strain={strain} />)}</div> : <div className={styles.emptyInline}>Tu historial aparecerá cuando abras fichas.</div>}</section>
          <section className={styles.contentSection}><SectionTitle title="Historial de análisis" />{data.scans.length ? <div className={styles.scanHistory}>{data.scans.map((scan) => <article key={scan.id}><ImagePlus size={18} /><div><strong>{scan.analysis.visualMatches?.[0]?.name || "Análisis visual"}</strong><span>{new Date(scan.created_at).toLocaleDateString("es-AR")}</span></div></article>)}</div> : <div className={styles.emptyInline}>Todavía no ejecutaste análisis.</div>}</section>
        </>
      )}
    </div>
  );
}
