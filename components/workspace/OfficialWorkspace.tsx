"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Globe2, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import styles from "./OfficialWorkspace.module.css";

type WorkspaceMode = "web" | "analyzer";
type PreviewMode = "actual" | "proposal" | "compare";
type AnalyzerBootState = "idle" | "ready" | "error";

type SessionCommand =
  | { type: "signed-in"; access_token: string; refresh_token: string }
  | { type: "signed-out" };

const PREVIEW_LABELS: Record<PreviewMode, string> = {
  actual: "Actual",
  proposal: "Propuesta",
  compare: "Comparar",
};

const PRODUCTION_URL = "https://clouva.com.ar";
const PREVIEW_URL = "https://clouva-workspace-preview-37640598175.us-central1.run.app";
const ANALYZER_URL = "https://clouva-analyzer-dev-6i67fzm65q-uc.a.run.app";
const WORKSPACE_AUTH_CHANNEL = "clouva-workspace-auth-v1";
const ANALYZER_AUTH_CHANNEL = "clouva-analyzer-auth-v1";
const PREVIEW_AUTH_CHANNEL = "clouva-preview-auth-v1";

function sessionCommand(session: ReturnType<typeof useAuth>["session"]): SessionCommand {
  return session?.access_token && session.refresh_token
    ? {
        type: "signed-in",
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }
    : { type: "signed-out" };
}

export function OfficialWorkspace() {
  const { session, hydrationReady } = useAuth();
  const [mode, setMode] = useState<WorkspaceMode>("web");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("actual");
  const [webReloadKey, setWebReloadKey] = useState(0);
  const [analyzerReloadKey, setAnalyzerReloadKey] = useState(0);
  const [analyzerBootState, setAnalyzerBootState] = useState<AnalyzerBootState>("idle");
  const [analyzerFrameReady, setAnalyzerFrameReady] = useState(false);
  const analyzerFrameRef = useRef<HTMLIFrameElement>(null);
  const proposalFrameRef = useRef<HTMLIFrameElement>(null);
  const compareProposalFrameRef = useRef<HTMLIFrameElement>(null);

  const statusText = useMemo(() => {
    if (mode === "web") return "Web protegida";
    if (analyzerBootState === "error") return "Analyzer sin respuesta";
    if (!analyzerFrameReady) return "Cargando Analyzer";
    return "Analyzer dev activo";
  }, [mode, analyzerBootState, analyzerFrameReady]);

  const postSession = useCallback(
    (target: Window | null | undefined, origin: string) => {
      if (!hydrationReady || !target) return;
      target.postMessage(
        { channel: WORKSPACE_AUTH_CHANNEL, command: sessionCommand(session) },
        origin,
      );
    },
    [hydrationReady, session],
  );

  const sendAnalyzerSession = useCallback(() => {
    postSession(analyzerFrameRef.current?.contentWindow, ANALYZER_URL);
  }, [postSession]);

  const sendProposalSessions = useCallback(() => {
    postSession(proposalFrameRef.current?.contentWindow, PREVIEW_URL);
    postSession(compareProposalFrameRef.current?.contentWindow, PREVIEW_URL);
  }, [postSession]);

  useEffect(() => {
    const handleReady = (event: MessageEvent) => {
      if (event.origin === ANALYZER_URL) {
        if (event.source !== analyzerFrameRef.current?.contentWindow) return;
        if (event.data?.channel !== ANALYZER_AUTH_CHANNEL || event.data?.type !== "ready") return;
        setAnalyzerFrameReady(true);
        sendAnalyzerSession();
        return;
      }

      if (event.origin === PREVIEW_URL) {
        const sourceMatches =
          event.source === proposalFrameRef.current?.contentWindow ||
          event.source === compareProposalFrameRef.current?.contentWindow;
        if (!sourceMatches) return;
        if (event.data?.channel !== PREVIEW_AUTH_CHANNEL || event.data?.type !== "ready") return;
        sendProposalSessions();
      }
    };

    window.addEventListener("message", handleReady);
    return () => window.removeEventListener("message", handleReady);
  }, [sendAnalyzerSession, sendProposalSessions]);

  useEffect(() => {
    if (mode !== "analyzer") return;
    setAnalyzerBootState("ready");
    setAnalyzerFrameReady(false);
  }, [mode, analyzerReloadKey]);

  useEffect(() => {
    if (!hydrationReady) return;
    if (mode === "analyzer" && analyzerBootState === "ready") sendAnalyzerSession();
    if (mode === "web" && previewMode !== "actual") sendProposalSessions();
  }, [hydrationReady, mode, previewMode, analyzerReloadKey, analyzerBootState, webReloadKey, sendAnalyzerSession, sendProposalSessions]);

  const openUrl = previewMode === "actual" ? PRODUCTION_URL : PREVIEW_URL;

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
                onClick={() => setWebReloadKey((value) => value + 1)}
                title="Recargar vista"
              >
                <RefreshCw size={16} />
              </button>
              <a className={styles.secondaryAction} href={openUrl} target="_blank" rel="noreferrer">
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
            <span>Los cambios viven en Propuesta. Producción queda intacta hasta una publicación explícita.</span>
          </div>

          <div className={styles.browserFrame}>
            <div className={styles.browserChrome}>
              <span className={styles.browserDot} />
              <span className={styles.browserDot} />
              <span className={styles.browserDot} />
              <div className={styles.addressBar}>
                {previewMode === "actual" ? "clouva.com.ar" : "preview aislada de CLOUVA"}
              </div>
              <span className={styles.modePill}>{PREVIEW_LABELS[previewMode]}</span>
            </div>

            {previewMode === "actual" && (
              <iframe
                key={`actual-${webReloadKey}`}
                className={styles.webPreview}
                src="/"
                title="CLOUVA Web actual"
              />
            )}

            {previewMode === "proposal" && (
              <iframe
                key={`proposal-${webReloadKey}`}
                ref={proposalFrameRef}
                className={styles.webPreview}
                src={PREVIEW_URL}
                title="CLOUVA Web propuesta"
                onLoad={sendProposalSessions}
              />
            )}

            {previewMode === "compare" && (
              <div className={styles.compareGrid}>
                <div className={styles.comparePane}>
                  <div className={styles.compareLabel}>ACTUAL · PRODUCCIÓN</div>
                  <iframe
                    key={`compare-actual-${webReloadKey}`}
                    className={styles.compareFrame}
                    src="/"
                    title="CLOUVA actual para comparar"
                  />
                </div>
                <div className={styles.comparePane}>
                  <div className={styles.compareLabel}>PROPUESTA · AISLADA</div>
                  <iframe
                    key={`compare-proposal-${webReloadKey}`}
                    ref={compareProposalFrameRef}
                    className={styles.compareFrame}
                    src={PREVIEW_URL}
                    title="CLOUVA propuesta para comparar"
                    onLoad={sendProposalSessions}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className={styles.analyzerArea}>
          <div className={styles.analyzerToolbar}>
            <div className={styles.analyzerStatus}>
              <span className={styles.liveDot} />
              <div>
                <strong>Analyzer Lab</strong>
                <span>
                  {analyzerBootState === "error"
                    ? "El runtime no respondió · tocá recargar"
                    : !analyzerFrameReady
                      ? "Cargando interfaz del Analyzer…"
                      : hydrationReady && session
                        ? "Runtime cloud · hot reload · sesión CLOUVA sincronizada"
                        : "Runtime cloud · hot reload · listo para probar"}
                </span>
              </div>
            </div>

            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setAnalyzerReloadKey((value) => value + 1)}
                title="Recargar Analyzer"
              >
                <RefreshCw size={16} />
              </button>
              <a className={styles.secondaryAction} href={ANALYZER_URL} target="_blank" rel="noreferrer">
                Abrir Analyzer
                <ExternalLink size={15} />
              </a>
            </div>
          </div>

          <div className={styles.analyzerSafetyStrip}>
            <ShieldCheck size={16} />
            <span>Laboratorio aislado: probar acá no publica cambios en CLOUVA Web.</span>
          </div>

          <div className={styles.analyzerFrame}>
            <iframe
              key={analyzerReloadKey}
              ref={analyzerFrameRef}
              className={styles.analyzerPreview}
              src={ANALYZER_URL}
              title="CLOUVA Analyzer Lab"
              allow="clipboard-read; clipboard-write"
              onLoad={() => {
                setAnalyzerFrameReady(true);
                sendAnalyzerSession();
              }}
            />

            {!analyzerFrameReady && (
              <div className={styles.analyzerLoading} role="status" aria-live="polite">
                <span className={styles.loadingSpinner} />
                <strong>Preparando Analyzer Lab</strong>
                <span>Cargando directamente el runtime cloud de desarrollo.</span>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
