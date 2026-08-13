"use client";

import { useMemo, useState } from "react";
import {
  ExternalLink,
  Globe2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import styles from "./OfficialWorkspace.module.css";

type WorkspaceMode = "web" | "analyzer";
type PreviewMode = "actual" | "proposal" | "compare";

const PREVIEW_LABELS: Record<PreviewMode, string> = {
  actual: "Actual",
  proposal: "Propuesta",
  compare: "Comparar",
};

export function OfficialWorkspace() {
  const [mode, setMode] = useState<WorkspaceMode>("web");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("actual");
  const [reloadKey, setReloadKey] = useState(0);

  const statusText = useMemo(
    () => (mode === "web" ? "Web protegida" : "Analyzer aislado"),
    [mode],
  );

  return (
    <main className={styles.workspaceRoot}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandMark}>C</div>
          <div>
            <p className={styles.eyebrow}>CLOUVA</p>
            <h1 className={styles.title}>Workspace</h1>
          </div>
        </div>

        <div className={styles.modeSwitch} aria-label="Sección del Workspace">
          <button
            type="button"
            className={`${styles.modeButton} ${mode === "web" ? styles.modeButtonActive : ""}`}
            onClick={() => setMode("web")}
          >
            <Globe2 size={17} />
            WEB
          </button>
          <button
            type="button"
            className={`${styles.modeButton} ${mode === "analyzer" ? styles.modeButtonActive : ""}`}
            onClick={() => setMode("analyzer")}
          >
            <ScanLine size={17} />
            ANALYZER LAB
          </button>
        </div>

        <div className={styles.safeBadge}>
          <ShieldCheck size={16} />
          {statusText}
        </div>
      </header>

      {mode === "web" ? (
        <section className={styles.webArea}>
          <div className={styles.workspaceToolbar}>
            <div className={styles.previewModes}>
              {(Object.keys(PREVIEW_LABELS) as PreviewMode[]).map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => setPreviewMode(item)}
                  className={`${styles.previewModeButton} ${previewMode === item ? styles.previewModeButtonActive : ""}`}
                >
                  {PREVIEW_LABELS[item]}
                </button>
              ))}
            </div>

            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setReloadKey((value) => value + 1)}
                title="Recargar vista"
              >
                <RefreshCw size={16} />
              </button>
              <a className={styles.secondaryAction} href="/" target="_blank" rel="noreferrer">
                Abrir aparte
                <ExternalLink size={15} />
              </a>
              <button type="button" className={styles.publishButton} disabled>
                Publicar desactivado
              </button>
            </div>
          </div>

          <div className={styles.safetyStrip}>
            <ShieldCheck size={16} />
            <span>
              Modo seguro activo: este Workspace no aplica cambios a producción.
            </span>
          </div>

          <div className={styles.browserFrame}>
            <div className={styles.browserChrome}>
              <span className={styles.browserDot} />
              <span className={styles.browserDot} />
              <span className={styles.browserDot} />
              <div className={styles.addressBar}>clouva.com.ar</div>
              <span className={styles.modePill}>{PREVIEW_LABELS[previewMode]}</span>
            </div>

            {previewMode === "actual" ? (
              <iframe
                key={reloadKey}
                className={styles.webPreview}
                src="/"
                title="CLOUVA Web actual"
              />
            ) : (
              <div className={styles.emptyState}>
                <Sparkles size={30} />
                <h2>{previewMode === "proposal" ? "Propuesta" : "Comparar"}</h2>
                <p>
                  Esta vista queda preparada para conectar el sistema de borradores sin tocar la web publicada.
                </p>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className={styles.analyzerArea}>
          <div className={styles.analyzerIntro}>
            <div className={styles.analyzerIcon}>
              <ScanLine size={28} />
            </div>
            <div>
              <p className={styles.eyebrow}>ANALYZER LAB</p>
              <h2>El Analyzer actual se conserva.</h2>
              <p>
                Este espacio será la interfaz oficial para seguir mejorándolo sin modificar CLOUVA Web.
              </p>
            </div>
          </div>

          <div className={styles.analyzerGrid}>
            <article className={styles.labCard}>
              <span className={styles.cardLabel}>Estado</span>
              <strong>Preservado</strong>
              <p>El Anatomy Lab existente no se reemplaza ni se reinicia desde cero.</p>
            </article>
            <article className={styles.labCard}>
              <span className={styles.cardLabel}>Web</span>
              <strong>Aislada</strong>
              <p>Las pruebas del Analyzer no tienen permiso para publicar cambios en la web.</p>
            </article>
            <article className={styles.labCard}>
              <span className={styles.cardLabel}>Próximo paso</span>
              <strong>Conectar el Analyzer real</strong>
              <p>Primero se integra la versión existente; después se mueve el procesamiento pesado a cloud.</p>
            </article>
          </div>

          <div className={styles.analyzerCanvasPlaceholder}>
            <div className={styles.scanGlow} />
            <ScanLine size={54} />
            <h3>Analyzer listo para integrar</h3>
            <p>
              En esta primera versión no se ejecuta ningún proceso local ni se modifica el Analyzer respaldado.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
