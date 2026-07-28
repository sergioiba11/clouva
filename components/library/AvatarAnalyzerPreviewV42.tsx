"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { AvatarAnalyzerPreview } from "./AvatarAnalyzerPreview";

type DiagnosticMode = "approved" | "full";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extractRunId(root: HTMLElement) {
  const link = root.querySelector<HTMLAnchorElement>('a[href^="/avatar-analyzer-v4/"]');
  if (!link) return null;
  const value = link.getAttribute("href") || "";
  return value.split("/").filter(Boolean).at(-1) || null;
}

function requestedProfile(root: HTMLElement) {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("strong"));
  return candidates
    .map((node) => node.textContent?.trim() || "")
    .find((value) => /^(BODY_|FULL_)/.test(value)) || "BODY_BASIC";
}

function bodyIsApproved(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("strong"))
    .some((node) => normalize(node.textContent || "") === "cuerpo valido");
}

function decorateLegacyUi(root: HTMLElement) {
  for (const node of root.querySelectorAll<HTMLElement>("small, h2")) {
    if (node.textContent?.includes("Avatar Analyzer V4.1")) {
      node.textContent = node.textContent.replace("Avatar Analyzer V4.1", "Avatar Analyzer V4.2");
    }
  }

  for (const paragraph of root.querySelectorAll<HTMLParagraphElement>("p")) {
    const text = paragraph.textContent || "";
    if (text.includes("0/7 vistas significa")) {
      paragraph.textContent = "Los módulos no solicitados no generan cámaras ni errores. La cobertura visual solo se calcula para los módulos ejecutados por el perfil actual.";
    }
    if (text.includes("crea dos pasadas regionales")) {
      paragraph.textContent = "Blender reutiliza la base geométrica, ejecuta solo los módulos solicitados y no genera el rig hasta aprobar el perfil anatómico.";
    }
  }

  const profile = requestedProfile(root);
  const bodyApproved = bodyIsApproved(root);
  const optionalExecution: Record<string, "not_run" | "base" | "full"> = {
    rostro: ["BODY_FACE", "FULL_BODY_HANDS_FACE"].includes(profile) ? "full" : "not_run",
    "mano izquierda": profile === "BODY_HANDS_BASIC" ? "base" : profile.startsWith("FULL_") ? "full" : "not_run",
    "mano derecha": profile === "BODY_HANDS_BASIC" ? "base" : profile.startsWith("FULL_") ? "full" : "not_run",
  };

  for (const article of root.querySelectorAll<HTMLElement>("article")) {
    const label = normalize(article.querySelector(":scope > span")?.textContent || "");
    if (!(label in optionalExecution)) continue;
    const mode = optionalExecution[label];
    const strong = article.querySelector<HTMLElement>(":scope > strong");
    const smalls = article.querySelectorAll<HTMLElement>(":scope > small");
    const renderedText = Array.from(smalls).map((node) => node.textContent || "").join(" ");
    const hasNoRenderedViews = /0\/0/.test(renderedText) || renderedText.includes("Detectadas 0/0");
    if (!hasNoRenderedViews) continue;
    if (mode === "not_run") {
      if (strong) strong.textContent = "Módulo no ejecutado";
      if (smalls[0]) smalls[0].textContent = "Sin cámaras solicitadas para este perfil";
      if (smalls[1]) smalls[1].textContent = "No bloquea el perfil actual";
    } else if (mode === "base") {
      if (strong) strong.textContent = "Base geométrica";
      if (smalls[0]) smalls[0].textContent = "Muñeca y palma · sin cámaras de dedos";
      if (smalls[1]) smalls[1].textContent = "La verificación visual completa no fue solicitada";
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
    const strong = button.querySelector<HTMLElement>("strong");
    const small = button.querySelector<HTMLElement>("small");
    if (!strong || !small || !/puntos/.test(normalize(small.textContent || ""))) continue;
    const group = normalize(strong.textContent || "");
    const current = normalize(small.textContent || "");
    if (!current.startsWith("0 puntos")) continue;
    if ((group === "cuerpo" || group === "piernas y pies") && bodyApproved) {
      small.textContent = "Subsistemas aprobados · sin pendientes";
      continue;
    }
    const execution = optionalExecution[group];
    if (execution === "not_run") {
      small.textContent = "Módulo no ejecutado";
    } else if (execution === "base") {
      small.textContent = "Base geométrica · sin dedos requeridos";
    } else if (execution === "full") {
      small.textContent = "Módulo aprobado · sin pendientes";
    }
  }
}

function AnalyzerV42Bridge({ accessToken }: { accessToken?: string }) {
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    let activeMode: DiagnosticMode = "approved";
    let activeKey = "";
    let scheduled = false;

    const root = document.getElementById("avatar-analyzer");
    if (!root) return undefined;

    const applyObjectUrl = () => {
      if (!objectUrl) return;
      const viewer = root.querySelector<HTMLElement>("model-viewer");
      if (!viewer) return;
      viewer.setAttribute("src", objectUrl);
      (viewer as HTMLElement & { src?: string }).src = objectUrl;
    };

    const loadDiagnostic = async (mode: DiagnosticMode) => {
      const runId = extractRunId(root);
      if (!runId || !accessToken) return;
      const key = `${runId}:${mode}`;
      if (key === activeKey && objectUrl) {
        window.requestAnimationFrame(applyObjectUrl);
        return;
      }
      activeKey = key;
      activeMode = mode;
      const filename = mode === "full" ? "diagnostic-full.glb" : "diagnostic-approved.glb";
      const response = await fetch(
        `/api/avatar/analyze/result/${runId}/asset/${filename}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      if (!response.ok || disposed || activeKey !== key) return;
      const blob = await response.blob();
      if (blob.size < 1024 || disposed || activeKey !== key) return;
      const nextUrl = URL.createObjectURL(blob);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = nextUrl;
      window.requestAnimationFrame(applyObjectUrl);
      window.setTimeout(applyObjectUrl, 80);
    };

    const refresh = () => {
      scheduled = false;
      decorateLegacyUi(root);
      if (objectUrl) applyObjectUrl();
    };

    const scheduleRefresh = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(refresh);
    };

    const onClick = (event: Event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
      if (!button || !root.contains(button)) return;
      const label = normalize(button.textContent || "");
      if (label.includes("mostrar todos los puntos tecnicos")) {
        void loadDiagnostic("full");
      } else if (label.includes("ocultar puntos internos aprobados")) {
        void loadDiagnostic("approved");
      }
    };

    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener("click", onClick, true);
    decorateLegacyUi(root);

    return () => {
      disposed = true;
      observer.disconnect();
      root.removeEventListener("click", onClick, true);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      activeKey = "";
      activeMode = "approved";
    };
  }, [accessToken]);

  return null;
}

export function AvatarAnalyzerPreviewV42() {
  const { session } = useAuth();
  return (
    <>
      <AvatarAnalyzerPreview />
      <AnalyzerV42Bridge accessToken={session?.access_token} />
    </>
  );
}
