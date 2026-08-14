const WORKSPACE_AUTH_CHANNEL = "clouva-workspace-auth-v1";
const ANALYZER_AUTH_CHANNEL = "clouva-analyzer-auth-v1";
const ALLOWED_WORKSPACE_ORIGINS = new Set([
  "https://clouva-workspace-preview-37640598175.us-central1.run.app",
  "https://clouva.com.ar",
  "https://www.clouva.com.ar",
]);

const PENDING_COMMAND_KEY = "__CLOUVA_WORKSPACE_PENDING_AUTH__";
const PREBOOT_LISTENER_KEY = "__CLOUVA_WORKSPACE_PREBOOT_LISTENER__";

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

function workspaceParentOrigin(target = window) {
  try {
    const referrerOrigin = target.document?.referrer ? new URL(target.document.referrer).origin : null;
    if (allowedWorkspaceOrigin(referrerOrigin)) return referrerOrigin;
  } catch {
    // Referrer can be intentionally suppressed.
  }

  try {
    const ancestorOrigin = target.location?.ancestorOrigins?.[0] || null;
    if (allowedWorkspaceOrigin(ancestorOrigin)) return ancestorOrigin;
  } catch {
    // ancestorOrigins is not available in every browser.
  }

  return null;
}

function postToWorkspace(target, payload, preferredOrigin = null) {
  if (!target?.parent || target.parent === target || typeof target.parent.postMessage !== "function") {
    return false;
  }

  if (allowedWorkspaceOrigin(preferredOrigin)) {
    target.parent.postMessage(payload, preferredOrigin);
    return true;
  }

  const parentOrigin = workspaceParentOrigin(target);
  if (parentOrigin) {
    target.parent.postMessage(payload, parentOrigin);
    return true;
  }

  for (const origin of ALLOWED_WORKSPACE_ORIGINS) {
    target.parent.postMessage(payload, origin);
  }
  return true;
}

function notifyWorkspaceReady(target = window) {
  return postToWorkspace(target, { channel: ANALYZER_AUTH_CHANNEL, type: "ready" });
}

function notifyWorkspaceAuthResult(target, result, preferredOrigin = null) {
  return postToWorkspace(
    target,
    {
      channel: ANALYZER_AUTH_CHANNEL,
      type: "auth-result",
      accepted: Boolean(result?.accepted),
      signedIn: Boolean(result?.signedIn),
      userId: result?.userId || null,
    },
    preferredOrigin,
  );
}

function installPrebootCommandQueue(target = window) {
  if (!target || typeof target.addEventListener !== "function" || target[PREBOOT_LISTENER_KEY]) return;

  const listener = (event) => {
    if (!allowedWorkspaceOrigin(event?.origin)) return;
    if (target.parent && event?.source !== target.parent) return;
    if (event?.data?.channel !== WORKSPACE_AUTH_CHANNEL) return;
    target[PENDING_COMMAND_KEY] = {
      command: event.data.command,
      origin: event.origin,
    };
  };

  target.addEventListener("message", listener);
  target[PREBOOT_LISTENER_KEY] = listener;
}

// Install the receiver immediately when the bundle evaluates. This removes the
// race where Workspace sends its canonical session before Supabase/config boot
// has finished inside the Analyzer iframe.
if (typeof window !== "undefined") {
  installPrebootCommandQueue(window);
  notifyWorkspaceReady(window);
}

/** Receive the canonical Workspace session through either the legacy verified
 * Electron handoff or the isolated CLOUVA Workspace web iframe bridge.
 * Workspace remains the canonical session owner. */
export function installWorkspaceAuthBridge({ target = window, client, onSession, onManagedChange }) {
  const receiver = async (command, preferredOrigin = null) => {
    let result;
    if (command?.type === "signed-out") {
      const signedOut = await client.auth.signOut({ scope: "local" });
      if (signedOut.error) throw signedOut.error;
      onManagedChange(false);
      onSession(null);
      result = { accepted: true, signedIn: false, userId: null };
      notifyWorkspaceAuthResult(target, result, preferredOrigin);
      return result;
    }
    if (!validSignedIn(command)) {
      result = { accepted: false, signedIn: false, userId: null };
      notifyWorkspaceAuthResult(target, result, preferredOrigin);
      return result;
    }

    const sessionResult = await client.auth.setSession({
      access_token: command.access_token,
      refresh_token: command.refresh_token,
    });
    if (sessionResult.error) throw sessionResult.error;
    client.auth.stopAutoRefresh();
    onManagedChange(true);
    onSession(sessionResult.data.session || null);
    const userId = sessionResult.data.session?.user?.id || null;
    result = { accepted: Boolean(userId), signedIn: Boolean(userId), userId };
    notifyWorkspaceAuthResult(target, result, preferredOrigin);
    return result;
  };

  target.__CLOUVA_WORKSPACE_SYNC_SESSION__ = receiver;

  const prebootListener = target[PREBOOT_LISTENER_KEY];
  if (prebootListener && typeof target.removeEventListener === "function") {
    target.removeEventListener("message", prebootListener);
    delete target[PREBOOT_LISTENER_KEY];
  }

  const handleMessage = (event) => {
    if (!allowedWorkspaceOrigin(event?.origin)) return;
    if (target.parent && event?.source !== target.parent) return;
    if (event?.data?.channel !== WORKSPACE_AUTH_CHANNEL) return;
    void receiver(event.data.command, event.origin).catch((error) => {
      console.error("[anatomy-lab] Workspace web auth handoff failed", error);
      notifyWorkspaceAuthResult(target, { accepted: false, signedIn: false, userId: null }, event.origin);
    });
  };

  if (typeof target.addEventListener === "function") {
    target.addEventListener("message", handleMessage);
  }

  const pending = target[PENDING_COMMAND_KEY];
  if (pending?.command) {
    delete target[PENDING_COMMAND_KEY];
    void receiver(pending.command, pending.origin).catch((error) => {
      console.error("[anatomy-lab] queued Workspace auth handoff failed", error);
      notifyWorkspaceAuthResult(target, { accepted: false, signedIn: false, userId: null }, pending.origin);
    });
  }

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
    installPrebootCommandQueue(target);
  };
}
