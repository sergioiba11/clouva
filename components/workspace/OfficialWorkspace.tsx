"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Globe2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import styles from "./OfficialWorkspace.module.css";

type WorkspaceMode = "web" | "analyzer";
type PreviewMode = "actual" | "proposal" | "compare";
type AnalyzerAuthState = "idle" | "sending" | "synced" | "failed";

const PREVIEW_LABELS: Record<PreviewMode, string> = {
  actual: "Actual",
  proposal: "Propuesta",
  compare: "Comparar",
};

const CLOUVA_WEB_URL = "https://clouva.com.ar";
const ANALYZER_URL = "https://clouva-anatomy-lab-preview-37640598175.us-central1.run.app";
const WORKSPACE_AUTH_CHANNEL = "clouva-workspace-auth-v1";
const ANALYZER_AUTH_CHANNEL = "clouva-analyzer-auth-v1";

export function OfficialWorkspace() {
  const { session, hydrationReady } = useAuth();
  const [mode, setMode] = useState<WorkspaceMode>("web");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("actual");
  const [webReloadKey, setWebReloadKey] = useState(0);
  const [analyzerReloadKey, setAnalyzerReloadKey] = useState(0);
  const [analyzerAuthState, setAnalyzerAuthState] = useState<AnalyzerAuthState>("idle");
  const analyzerFrameRef = useRef<HTMLIFrameElement>(null);

  const statusText = useMemo(
    () => (mode === "web" ? "Web protegida" : "Analyzer cloud activo"),
    [mode],
  );

  const sendAnalyzerSession = useCallback(() => {
    if (!hydrationReady) return;
    const target = analyzerFrameRef.current?.contentWindow;
    if (!target) return;

    const command = session?.access_token && session.refresh_token
      ? {
          type: "signed-in" as const,
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }
      : { type: "signed-out" as const };

    setAnalyzerAuthState("sending");
    target.postMessage({ channel: WORKSPACE_AUTH_CHANNEL, command }, ANALYZER_URL);
  }, [hydrationReady, session?.access_token, session?.refresh_token]);

  useEffect(() => {
    const handleAnalyzerMessage = (event: MessageEvent) => {
      if (event.origin !== ANALYZER_URL) return;
      if (event.source !== analyzerFrameRef.current?.contentWindow) return;
      if (event.data?.channel !== ANALYZER_AUTH_CHANNEL) return;

      if (event.data?.type === "ready") {
        sendAnalyzerSession();
        return;
      }

      if (event.data?.type === "auth-result") {
        const expectedSignedIn = Boolean(session?.access_token && session.refresh_token);
        const accepted = Boolean(event.data?.accepted);
        const signedIn = Boolean(event.data?.signedIn);
        setAnalyzerAuthState(accepted && signedIn === expectedSignedIn ? "synced" : "failed");
      }
    };

    window.addEventListener("message", handleAnalyzerMessage);
    return () => window.removeEventListener("message", handleAnalyzerMessage);
  }, [sendAnalyzerSession, session?.access_token, session?.refresh_token]);

  useEffect(() => {
    if (mode === "analyzer") sendAnalyzerSession();
  }, [mode, analyzerReloadKey, sendAnalyzerSession]);

  useEffect(() => {
    setAnalyzerAuthState("idle");
  }, [session?.access_token, session?.refresh_token]);

  const analyzerSessionLabel = useMemo(() => {
    if (!hydrationReady) return "Cloud aislado · preparando sesión";
    if (!session) return "Cloud aislado · sin sesión CLOUVA";
    if (analyzerAuthState === "synced") return "Cloud aislado · sesión CLOUVA verificada";
    if (analyzerAuthState === "failed") return "Cloud aislado · sesión CLOUVA no aceptada";
    return "Cloud aislado · sincronizando sesión CLOUVA…";
  }, [hydrationReady, session, analyzerAuthState]);

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
              <a className={styles.secondaryAction} href={CLOUVA_WEB_URL} target="_blank" rel="noreferrer">
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
            <span>Modo seguro activo: este Workspace no aplica cambios a producción.</span>
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
                key={webReloadKey}
                className={styles.webPreview}
                src={CLOUVA_WEB_URL}
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
          <div className={styles.analyzerToolbar}>
            <div className={styles.analyzerStatus}>
              <span className={styles.liveDot} />
              <div>
                <strong>Analyzer Lab</strong>
                <span>{analyzerSessionLabel}</span>
              </div>
            </div>

            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  setAnalyzerAuthState("idle");
                  setAnalyzerReloadKey((value) => value + 1);
                }}
                title="Recargar Analyzer"
              >
                <RefreshCw size={16} />
              </button>
              <a
                className={styles.secondaryAction}
                href={ANALYZER_URL}
                target="_blank"
                rel="noreferrer"
              >
                Abrir Analyzer
                <ExternalLink size={15} />
              </a>
            </div>
          </div>

          <div className={styles.analyzerSafetyStrip}>
            <ShieldCheck size={16} />
            <span>Laboratorio aislado: trabajar acá no publica cambios en CLOUVA Web.</span>
          </div>

          <div className={styles.analyzerFrame}>
            <iframe
              key={analyzerReloadKey}
              ref={analyzerFrameRef}
              className={styles.analyzerPreview}
              src={ANALYZER_URL}
              title="CLOUVA Analyzer Lab"
              allow="clipboard-read; clipboard-write"
              onLoad={sendAnalyzerSession}
            />
          </div>
        </section>
      )}
    </main>
  );
}
