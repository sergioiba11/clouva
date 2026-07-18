"use client";

import Link from "next/link";
import {
  Box,
  Check,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Image as ImageIcon,
  Layers3,
  LibraryBig,
  Loader2,
  Music2,
  RefreshCw,
  Search,
  Shirt,
  Sparkles,
  Video,
  WandSparkles,
} from "lucide-react";
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import styles from "./clouva-library.module.css";

type VisibleAssetKind = "3d" | "image" | "audio" | "video";
type AssetKind = VisibleAssetKind | "other";
type TabId = "all" | VisibleAssetKind;
type ScopeFilter = "all" | "personal" | "shared";

type StorageEntry = {
  id?: string | null;
  name: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SourceConfig = {
  bucket: string;
  basePath: string;
  label: string;
  scope: Exclude<ScopeFilter, "all">;
  maxDepth: number;
};

type PendingAsset = {
  id: string;
  name: string;
  path: string;
  bucket: string;
  kind: VisibleAssetKind;
  extension: string;
  size: number | null;
  updatedAt: string | null;
  sourceLabel: string;
  scope: Exclude<ScopeFilter, "all">;
};

type LibraryAsset = PendingAsset & {
  url: string;
  isActiveAvatar: boolean;
  status: string | null;
};

type AvatarState = {
  active: boolean;
  status: string | null;
};

const TABS: Array<{ id: TabId; label: string; Icon: typeof Box }> = [
  { id: "all", label: "Todo", Icon: LibraryBig },
  { id: "3d", label: "3D / GLB", Icon: Box },
  { id: "image", label: "Imágenes", Icon: ImageIcon },
  { id: "audio", label: "Sonido", Icon: Music2 },
  { id: "video", label: "Video", Icon: Video },
];

const EXTENSIONS: Record<AssetKind, string[]> = {
  "3d": ["glb", "gltf", "fbx", "obj", "usdz"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"],
  audio: ["mp3", "wav", "ogg", "m4a", "aac", "flac"],
  video: ["mp4", "webm", "mov", "m4v"],
  other: [],
};

function extensionOf(name: string) {
  const clean = name.split("?")[0];
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
}

function kindFromName(name: string): AssetKind {
  const extension = extensionOf(name);
  for (const [kind, extensions] of Object.entries(EXTENSIONS) as Array<[AssetKind, string[]]>) {
    if (extensions.includes(extension)) return kind;
  }
  return "other";
}

function isFolder(entry: StorageEntry) {
  return !entry.metadata && !extensionOf(entry.name);
}

function formatBytes(bytes: number | null) {
  if (!bytes || bytes <= 0) return "Tamaño no informado";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function readableName(asset: Pick<LibraryAsset, "name" | "path">) {
  if (asset.name.toLowerCase() === "avatar.glb") {
    const parts = asset.path.split("/").filter(Boolean);
    const avatarId = parts.at(-2)?.slice(0, 8);
    return avatarId ? `Avatar ${avatarId}` : "Avatar CLOUVA";
  }
  return asset.name.replace(/[-_]+/g, " ").replace(/\.[^.]+$/, "");
}

function kindLabel(kind: VisibleAssetKind) {
  if (kind === "3d") return "Modelo 3D";
  if (kind === "image") return "Imagen";
  if (kind === "audio") return "Audio";
  return "Video";
}

async function listFolderDeep(source: SourceConfig, currentPath = source.basePath, depth = 0): Promise<PendingAsset[]> {
  const { data, error } = await supabase.storage.from(source.bucket).list(currentPath, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });

  if (error) throw error;

  const files: PendingAsset[] = [];
  for (const rawEntry of data ?? []) {
    const entry = rawEntry as StorageEntry;
    const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

    if (isFolder(entry)) {
      if (depth < source.maxDepth) files.push(...(await listFolderDeep(source, fullPath, depth + 1)));
      continue;
    }

    const kind = kindFromName(entry.name);
    if (kind === "other") continue;

    const metadata = entry.metadata ?? {};
    const rawSize = metadata.size;
    const size = typeof rawSize === "number" ? rawSize : typeof rawSize === "string" ? Number(rawSize) : null;

    files.push({
      id: `${source.bucket}:${fullPath}`,
      name: entry.name,
      path: fullPath,
      bucket: source.bucket,
      kind,
      extension: extensionOf(entry.name),
      size: Number.isFinite(size) ? size : null,
      updatedAt: entry.updated_at ?? entry.created_at ?? null,
      sourceLabel: source.label,
      scope: source.scope,
    });
  }

  return files;
}

async function attachUrls(assets: PendingAsset[]) {
  const grouped = new Map<string, PendingAsset[]>();
  assets.forEach((asset) => grouped.set(asset.bucket, [...(grouped.get(asset.bucket) ?? []), asset]));

  const resolved: Array<PendingAsset & { url: string }> = [];
  for (const [bucket, bucketAssets] of grouped) {
    const paths = bucketAssets.map((asset) => asset.path);
    const signed = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    const signedMap = new Map<string, string>();

    if (!signed.error) {
      for (const item of signed.data ?? []) {
        if (item.path && item.signedUrl) signedMap.set(item.path, item.signedUrl);
      }
    }

    bucketAssets.forEach((asset) => {
      const publicUrl = supabase.storage.from(bucket).getPublicUrl(asset.path).data.publicUrl;
      resolved.push({ ...asset, url: signedMap.get(asset.path) ?? publicUrl });
    });
  }

  return resolved;
}

function AssetIcon({ kind }: { kind: VisibleAssetKind }) {
  if (kind === "3d") return <Box />;
  if (kind === "image") return <ImageIcon />;
  if (kind === "audio") return <Music2 />;
  return <Video />;
}

function AssetPreview({ asset, compact = false }: { asset: LibraryAsset; compact?: boolean }) {
  if (asset.kind === "image") {
    return <img className={styles.mediaPreview} src={asset.url} alt={readableName(asset)} loading="lazy" />;
  }

  if (asset.kind === "audio") {
    return (
      <div className={styles.audioPreview}>
        <Music2 />
        {!compact ? <audio controls preload="metadata" src={asset.url} /> : null}
      </div>
    );
  }

  if (asset.kind === "video") {
    return <video className={styles.mediaPreview} controls={!compact} muted={compact} preload="metadata" src={asset.url} />;
  }

  if (asset.extension === "glb" || asset.extension === "gltf") {
    return createElement("model-viewer", {
      className: styles.modelPreview,
      src: asset.url,
      alt: readableName(asset),
      "camera-controls": compact ? undefined : true,
      "auto-rotate": true,
      "rotation-per-second": "20deg",
      "shadow-intensity": "1",
      exposure: "1",
      loading: "lazy",
    });
  }

  return (
    <div className={styles.fallbackPreview}>
      <Box />
      {!compact ? <small>Vista previa disponible al convertir a GLB</small> : null}
    </div>
  );
}

function creativeAdvice(asset: LibraryAsset | null) {
  if (!asset) return "Elegí un archivo y CLOUVA te muestra cómo aprovecharlo dentro del ecosistema.";
  if (asset.kind === "3d" && asset.name.toLowerCase() === "avatar.glb") {
    return "Este cuerpo puede entrar al flujo de autorig: validar A-pose, generar esqueleto y después vestirlo en Unreal.";
  }
  if (asset.kind === "3d") {
    return "Probalo sobre el avatar, validá escala y colisiones, y guardalo como objeto equipable para web y CLOUVA World.";
  }
  if (asset.kind === "image") {
    return "Podés usarla como referencia visual para Meshy, textura, portada, producto o escenario dentro de CLOUVA World.";
  }
  if (asset.kind === "audio") {
    return "Podés asignarlo a un perfil, una sala, una prenda musical, una misión o una experiencia del Estudio 223.";
  }
  return "Podés usarlo como pantalla de mundo, videoclip, presentación de un drop o fondo cinematográfico.";
}

export function ClouvaLibrary() {
  const { user, profile, loading: authLoading } = useAuth();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceCount, setSourceCount] = useState(0);

  const loadLibrary = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setNotice(null);

    try {
      const avatarState = new Map<string, AvatarState>();
      const avatarRows = await supabase.from("user_avatars").select("*").eq("user_id", user.id);

      if (!avatarRows.error) {
        for (const rawRow of avatarRows.data ?? []) {
          const row = rawRow as Record<string, unknown>;
          const id = typeof row.id === "string" ? row.id : null;
          if (!id) continue;
          avatarState.set(id, {
            active: row.is_active === true,
            status: typeof row.status === "string" ? row.status : null,
          });
        }
      }

      const avatarSources: SourceConfig[] = [...avatarState.keys()].flatMap((avatarId) => [
        { bucket: "avatars", basePath: avatarId, label: "Avatares", scope: "personal", maxDepth: 3 },
        { bucket: "avatars", basePath: `${user.id}/${avatarId}`, label: "Avatares", scope: "personal", maxDepth: 3 },
      ]);

      const sources: SourceConfig[] = [
        ...avatarSources,
        { bucket: "avatars", basePath: user.id, label: "Avatares", scope: "personal", maxDepth: 3 },
        { bucket: "creator-reference-assets", basePath: user.id, label: "Referencias", scope: "personal", maxDepth: 3 },
        { bucket: "creator-assets", basePath: user.id, label: "Creaciones", scope: "personal", maxDepth: 3 },
        { bucket: "audio", basePath: user.id, label: "Audio", scope: "personal", maxDepth: 3 },
        { bucket: "sounds", basePath: user.id, label: "Sonidos", scope: "personal", maxDepth: 3 },
        { bucket: "music", basePath: user.id, label: "Música", scope: "personal", maxDepth: 3 },
        { bucket: "videos", basePath: user.id, label: "Videos", scope: "personal", maxDepth: 3 },
        { bucket: "media", basePath: user.id, label: "Multimedia", scope: "personal", maxDepth: 3 },
        { bucket: "products", basePath: "", label: "Productos", scope: "shared", maxDepth: 2 },
        { bucket: "product-images", basePath: "", label: "Imágenes de producto", scope: "shared", maxDepth: 2 },
        { bucket: "brand-assets", basePath: "", label: "Marca CLOUVA", scope: "shared", maxDepth: 2 },
      ];

      const results = await Promise.allSettled(sources.map((source) => listFolderDeep(source)));
      const successful = results.filter((result): result is PromiseFulfilledResult<PendingAsset[]> => result.status === "fulfilled");
      setSourceCount(successful.filter((result) => result.value.length > 0).length);

      const uniquePending = new Map<string, PendingAsset>();
      successful.flatMap((result) => result.value).forEach((asset) => uniquePending.set(asset.id, asset));

      const withUrls = await attachUrls([...uniquePending.values()]);
      const nextAssets: LibraryAsset[] = withUrls
        .map((asset) => {
          const matchingAvatar = [...avatarState.entries()].find(([avatarId]) => asset.path.includes(avatarId));
          return {
            ...asset,
            isActiveAvatar: matchingAvatar?.[1].active ?? false,
            status: matchingAvatar?.[1].status ?? null,
          };
        })
        .sort((a, b) => Number(b.isActiveAvatar) - Number(a.isActiveAvatar) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

      setAssets(nextAssets);
      setSelectedId((current) => (current && nextAssets.some((asset) => asset.id === current) ? current : nextAssets[0]?.id ?? null));

      if (nextAssets.length === 0) {
        setNotice("No encontramos archivos visibles todavía. La pantalla ya está lista para mostrarlos cuando estén disponibles en Storage.");
      }
    } catch (error) {
      console.error("CLOUVA library load failed", error);
      setNotice("La Biblioteca no pudo leer todos los recursos. Revisá permisos o tocá Actualizar.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (activeTab !== "all" && asset.kind !== activeTab) return false;
      if (scope !== "all" && asset.scope !== scope) return false;
      if (!normalizedQuery) return true;
      return `${asset.name} ${asset.path} ${asset.sourceLabel} ${kindLabel(asset.kind)}`.toLowerCase().includes(normalizedQuery);
    });
  }, [activeTab, assets, query, scope]);

  const selected = assets.find((asset) => asset.id === selectedId) ?? null;
  const counts = useMemo<Record<TabId, number>>(() => ({
    all: assets.length,
    "3d": assets.filter((asset) => asset.kind === "3d").length,
    image: assets.filter((asset) => asset.kind === "image").length,
    audio: assets.filter((asset) => asset.kind === "audio").length,
    video: assets.filter((asset) => asset.kind === "video").length,
  }), [assets]);

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
      window.setTimeout(() => setNotice(null), 2600);
    } catch {
      setNotice("No se pudo copiar automáticamente. Abrí el archivo y copiá el enlace desde el navegador.");
    }
  };

  const copyUnrealCommand = async () => {
    if (!selected) return;
    const payload = JSON.stringify({
      action: "import_asset",
      asset: {
        id: selected.id,
        name: readableName(selected),
        type: selected.kind,
        url: selected.url,
        source_bucket: selected.bucket,
        source_path: selected.path,
      },
    }, null, 2);
    await copyText(payload, "Comando para CLOUVA Unreal Bridge copiado.");
  };

  if (authLoading) {
    return (
      <main className={styles.centerState}>
        <Loader2 className={styles.spinner} />
        <p>Abriendo tu Biblioteca CLOUVA…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.centerState}>
        <LibraryBig />
        <h1>Tu biblioteca necesita una cuenta</h1>
        <p>Iniciá sesión para ver tus avatares, GLB, imágenes, sonidos y videos.</p>
        <Link href="/login" className={styles.primaryButton}>Iniciar sesión</Link>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.ambientGlow} aria-hidden="true" />

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Volver al inicio">
          <span className={styles.brandMark}>✣</span>
          <span>CLOUVA</span>
        </Link>
        <div className={styles.headerTitle}>
          <span>Biblioteca creativa</span>
          <small>{profile?.display_name || profile?.full_name || "Tu universo"}</small>
        </div>
        <nav className={styles.headerNav}>
          <Link href="/mi-flow/avatar">Avatar</Link>
          <Link href="/tienda">Tienda</Link>
          <Link href="/">Inicio</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}><Sparkles /> TU ARCHIVO CREATIVO VIVO</p>
          <h1>Todo lo que creás,<br /><span>siempre a mano.</span></h1>
          <p className={styles.heroCopy}>Modelos 3D, referencias, imágenes, sonido y video conectados al avatar, al Marketplace y a CLOUVA World.</p>
        </div>

        <div className={styles.pipelineCard}>
          <div className={styles.pipelineHead}>
            <WandSparkles />
            <div>
              <strong>Mapa de producción</strong>
              <span>La biblioteca une creación y uso.</span>
            </div>
          </div>
          <div className={styles.pipeline}>
            {["Idea", "Archivo", "Validar", "Equipar", "Vender", "World"].map((step, index) => (
              <div key={step} className={styles.pipelineStep}>
                <span>{index + 1}</span>
                <small>{step}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.stats}>
        <article><Database /><div><strong>{counts.all}</strong><span>archivos encontrados</span></div></article>
        <article><Box /><div><strong>{counts["3d"]}</strong><span>modelos 3D</span></div></article>
        <article><ImageIcon /><div><strong>{counts.image}</strong><span>imágenes</span></div></article>
        <article><Layers3 /><div><strong>{sourceCount}</strong><span>fuentes conectadas</span></div></article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar avatar, prenda, referencia, canción…" />
        </div>
        <button className={styles.refreshButton} type="button" onClick={() => void loadLibrary()} disabled={loading}>
          <RefreshCw className={loading ? styles.spinner : undefined} />
          Actualizar
        </button>
      </section>

      <div className={styles.tabs}>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={activeTab === id ? styles.activeTab : undefined} onClick={() => setActiveTab(id)}>
            <Icon />
            <span>{label}</span>
            <small>{counts[id]}</small>
          </button>
        ))}
      </div>

      {notice ? <div className={styles.notice}><Check />{notice}</div> : null}

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.sideSection}>
            <p className={styles.sideLabel}>PROPIEDAD</p>
            {([
              ["all", "Todo", Layers3],
              ["personal", "Mis creaciones", Sparkles],
              ["shared", "CLOUVA / Tienda", Database],
            ] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" className={scope === id ? styles.activeSideButton : undefined} onClick={() => setScope(id)}>
                <Icon />{label}
              </button>
            ))}
          </div>

          <div className={styles.sideSection}>
            <p className={styles.sideLabel}>COLECCIONES INTELIGENTES</p>
            <button type="button" onClick={() => { setActiveTab("3d"); setQuery("avatar"); }}><Box />Avatares</button>
            <button type="button" onClick={() => { setActiveTab("3d"); setQuery(""); }}><Shirt />Prendas y objetos</button>
            <button type="button" onClick={() => { setActiveTab("image"); setQuery(""); }}><ImageIcon />Visuales</button>
            <button type="button" onClick={() => { setActiveTab("audio"); setQuery(""); }}><Music2 />Música y sonido</button>
            <button type="button" onClick={() => { setActiveTab("video"); setQuery(""); }}><Video />Videos</button>
          </div>

          <div className={styles.bridgeCard}>
            <Gamepad2 />
            <strong>CLOUVA Unreal Bridge</strong>
            <p>Seleccioná un recurso y copiá la orden que después podrá recibir Unreal.</p>
            <button type="button" onClick={() => void copyUnrealCommand()} disabled={!selected}>Copiar orden</button>
          </div>
        </aside>

        <div className={styles.assetArea}>
          <div className={styles.assetAreaHead}>
            <div>
              <h2>{activeTab === "all" ? "Todos los recursos" : TABS.find((tab) => tab.id === activeTab)?.label}</h2>
              <p>{filteredAssets.length} resultados</p>
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingGrid}>
              <Loader2 className={styles.spinner} />
              <p>Buscando tus archivos en Supabase…</p>
            </div>
          ) : filteredAssets.length > 0 ? (
            <div className={styles.assetGrid}>
              {filteredAssets.map((asset) => (
                <button key={asset.id} type="button" className={`${styles.assetCard} ${selectedId === asset.id ? styles.selectedCard : ""}`} onClick={() => setSelectedId(asset.id)}>
                  <div className={styles.assetThumb}>
                    <AssetPreview asset={asset} compact />
                    <span className={styles.kindBadge}><AssetIcon kind={asset.kind} />{kindLabel(asset.kind)}</span>
                    {asset.isActiveAvatar ? <span className={styles.activeBadge}><Check />Activo</span> : null}
                  </div>
                  <div className={styles.assetCardBody}>
                    <strong>{readableName(asset)}</strong>
                    <span>{asset.sourceLabel} · {formatBytes(asset.size)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <FolderOpen />
              <h3>No hay recursos con este filtro</h3>
              <p>Probá otra colección o tocá Actualizar.</p>
            </div>
          )}
        </div>

        <aside className={styles.inspector}>
          {selected ? (
            <>
              <div className={styles.inspectorPreview}><AssetPreview asset={selected} /></div>
              <div className={styles.inspectorTitle}>
                <span><AssetIcon kind={selected.kind} />{kindLabel(selected.kind)}</span>
                <h2>{readableName(selected)}</h2>
                <p>{selected.path}</p>
              </div>

              <div className={styles.metaGrid}>
                <div><span>Formato</span><strong>{selected.extension.toUpperCase()}</strong></div>
                <div><span>Tamaño</span><strong>{formatBytes(selected.size)}</strong></div>
                <div><span>Origen</span><strong>{selected.sourceLabel}</strong></div>
                <div><span>Estado</span><strong>{selected.status || (selected.scope === "personal" ? "Propio" : "Compartido")}</strong></div>
              </div>

              <div className={styles.inspectorActions}>
                {selected.kind === "3d" ? (
                  <Link href={`/mi-flow/avatar?asset=${encodeURIComponent(selected.url)}&libraryAsset=${encodeURIComponent(selected.id)}`} className={styles.primaryButton}>
                    <Shirt /> Probar en avatar
                  </Link>
                ) : null}
                <a href={selected.url} target="_blank" rel="noreferrer"><ExternalLink /> Abrir archivo</a>
                <button type="button" onClick={() => void copyText(selected.url, "Enlace copiado.")}><Copy /> Copiar enlace</button>
                <a href={selected.url} download><Download /> Descargar</a>
              </div>

              <div className={styles.coachCard}>
                <div className={styles.coachHead}><Sparkles /><strong>Asistente creativo</strong></div>
                <p>{creativeAdvice(selected)}</p>
                <div className={styles.nextMove}>
                  <span>Movimiento recomendado</span>
                  <strong>{selected.kind === "3d" ? "Validar y equipar" : selected.kind === "image" ? "Usar como referencia" : "Vincular a una experiencia"}</strong>
                  <ChevronRight />
                </div>
              </div>
            </>
          ) : (
            <div className={styles.emptyInspector}>
              <Sparkles />
              <h3>Elegí un recurso</h3>
              <p>Acá vas a verlo, descargarlo, probarlo y decidir dónde usarlo.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
