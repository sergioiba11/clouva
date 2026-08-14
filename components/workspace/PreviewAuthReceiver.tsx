"use client";

import { useEffect } from "react";

const WORKSPACE_AUTH_CHANNEL = "clouva-workspace-auth-v1";
const PREVIEW_AUTH_CHANNEL = "clouva-preview-auth-v1";
const ALLOWED_PARENT_ORIGINS = new Set([
  "https://clouva.com.ar",
  "https://www.clouva.com.ar",
]);

// Only the official CLOUVA origin may hand a session into the isolated preview.
export function PreviewAuthReceiver() {
  useEffect(() => {
    if (window.parent === window) return;

    const parentOrigin = (() => {
      try {
        return document.referrer ? new URL(document.referrer).origin : null;
      } catch {
        return null;
      }
    })();

    if (!parentOrigin || !ALLOWED_PARENT_ORIGINS.has(parentOrigin)) return;

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      if (event.data?.channel !== WORKSPACE_AUTH_CHANNEL) return;

      const command = event.data?.command;
      const { supabase } = await import("@/lib/supabase");

      if (command?.type === "signed-out") {
        await supabase.auth.signOut({ scope: "local" });
        return;
      }

      if (
        command?.type !== "signed-in" ||
        typeof command.access_token !== "string" ||
        typeof command.refresh_token !== "string" ||
        !command.access_token ||
        !command.refresh_token
      ) {
        return;
      }

      const result = await supabase.auth.setSession({
        access_token: command.access_token,
        refresh_token: command.refresh_token,
      });

      if (result.error) {
        console.error("[workspace-preview] session handoff failed", result.error);
      }
    };

    window.addEventListener("message", handleMessage);
    window.parent.postMessage({ channel: PREVIEW_AUTH_CHANNEL, type: "ready" }, parentOrigin);

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}
