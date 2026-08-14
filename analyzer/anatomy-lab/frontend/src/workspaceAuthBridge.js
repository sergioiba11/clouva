const WORKSPACE_AUTH_CHANNEL = "clouva-workspace-auth-v1";
const ANALYZER_AUTH_CHANNEL = "clouva-analyzer-auth-v1";
const ALLOWED_WORKSPACE_ORIGINS = new Set([
  "https://clouva-workspace-preview-37640598175.us-central1.run.app",
  "https://clouva.com.ar",
  "https://www.clouva.com.ar",
]);

function validSignedIn(command) {
  return command?.type === "signed-in"
    && typeof command.access_token === "string"
    && command.access_token.length > 0
    && typeof command.refresh_token === "string"
    && command.refresh_token.length > 0;
}

function allowedWorkspaceOrigin(origin) {
  return typeof origin === "string" && ALLOWED_WORKSPACE_ORIGINS.has(origin);
}

function notifyWorkspaceReady(target = window) {
  try {
    const parentOrigin = target.document?.referrer ? new URL(target.document.referrer).origin : null;
    if (
      parentOrigin
      && allowedWorkspaceOrigin(parentOrigin)
      && target.parent
      && target.parent !== target
      && typeof target.parent.postMessage === "function"
    ) {
      target.parent.postMessage({ channel: ANALYZER_AUTH_CHANNEL, type: "ready" }, parentOrigin);
      return true;
    }
  } catch {
    // Standalone Analyzer does not need the Workspace web bridge.
  }
  return false;
}

// Signal iframe readiness as soon as this module is evaluated. The Workspace
// must be able to reveal the Analyzer UI even while Supabase/auth boot is still
// initializing in the background.
if (typeof window !== "undefined") {
  notifyWorkspaceReady(window);
}

/** Receive the canonical Workspace session through either the legacy verified
 * Electron handoff or the isolated CLOUVA Workspace web iframe bridge.
 * Workspace remains the canonical session owner. */
export function installWorkspaceAuthBridge({ target = window, client, onSession, onManagedChange }) {
  const receiver = async (command) => {
    if (command?.type === "signed-out") {
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      onManagedChange(false);
      onSession(null);
      return { accepted: true, signedIn: false, userId: null };
    }
    if (!validSignedIn(command)) return { accepted: false, signedIn: false, userId: null };

    const result = await client.auth.setSession({
      access_token: command.access_token,
      refresh_token: command.refresh_token,
    });
    if (result.error) throw result.error;
    client.auth.stopAutoRefresh();
    onManagedChange(true);
    onSession(result.data.session || null);
    const userId = result.data.session?.user?.id || null;
    return { accepted: Boolean(userId), signedIn: Boolean(userId), userId };
  };

  target.__CLOUVA_WORKSPACE_SYNC_SESSION__ = receiver;

  const handleMessage = (event) => {
    if (!allowedWorkspaceOrigin(event?.origin)) return;
    if (target.parent && event?.source !== target.parent) return;
    if (event?.data?.channel !== WORKSPACE_AUTH_CHANNEL) return;
    void receiver(event.data.command).catch((error) => {
      console.error("[anatomy-lab] Workspace web auth handoff failed", error);
    });
  };

  if (typeof target.addEventListener === "function") {
    target.addEventListener("message", handleMessage);
  }

  // Supabase boot can briefly race the iframe load event. Re-announce readiness
  // a few times after the receiver exists so the parent resends its canonical
  // session after local auth initialization has settled. This keeps Analyzer
  // hot-reload only; no Workspace or Cloud Run deploy is needed for auth fixes.
  const retryDelays = [0, 150, 500, 1200, 2500, 5000];
  const readyTimers = retryDelays.map((delay) => target.setTimeout?.(() => notifyWorkspaceReady(target), delay));

  return () => {
    readyTimers.forEach((timer) => {
      if (timer !== undefined && timer !== null) target.clearTimeout?.(timer);
    });
    if (target.__CLOUVA_WORKSPACE_SYNC_SESSION__ === receiver) {
      delete target.__CLOUVA_WORKSPACE_SYNC_SESSION__;
    }
    if (typeof target.removeEventListener === "function") {
      target.removeEventListener("message", handleMessage);
    }
  };
}
