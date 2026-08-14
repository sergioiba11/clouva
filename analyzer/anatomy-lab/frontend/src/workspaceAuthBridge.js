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

function normalizeCommand(data) {
  const candidate = data?.command && typeof data.command === "object" ? data.command : data;
  if (candidate?.type === "signed-out") return { type: "signed-out" };
  if (validSignedIn(candidate)) return candidate;

  const accessToken = candidate?.accessToken || candidate?.access_token || data?.accessToken || data?.access_token;
  const refreshToken = candidate?.refreshToken || candidate?.refresh_token || data?.refreshToken || data?.refresh_token;
  if (typeof accessToken === "string" && accessToken && typeof refreshToken === "string" && refreshToken) {
    return {
      type: "signed-in",
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }
  return null;
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

function notifyWorkspaceReady(target = window, preferredOrigin = null) {
  const ready = postToWorkspace(
    target,
    { channel: ANALYZER_AUTH_CHANNEL, type: "ready" },
    preferredOrigin,
  );
  postToWorkspace(
    target,
    { channel: ANALYZER_AUTH_CHANNEL, type: "request-session" },
    preferredOrigin,
  );
  return ready;
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
    const command = normalizeCommand(event?.data);
    if (!command) return;
    const channel = event?.data?.channel;
    if (channel && channel !== WORKSPACE_AUTH_CHANNEL) return;
    target[PENDING_COMMAND_KEY] = {
      command,
      origin: event.origin,
    };
  };

  target.addEventListener("message", listener);
  target[PREBOOT_LISTENER_KEY] = listener;
}

// Install immediately so a session sent by Workspace can never be lost while
// Supabase/config is still booting inside the Analyzer iframe.
if (typeof window !== "undefined") {
  installPrebootCommandQueue(window);
  notifyWorkspaceReady(window);
}

/**
 * Receive the canonical CLOUVA session from Workspace.
 * The Analyzer never becomes the canonical owner of that session: it only
 * mirrors it locally and stops its own refresh loop while Workspace manages it.
 */
export function installWorkspaceAuthBridge({ target = window, client, onSession, onManagedChange }) {
  const receiver = async (rawCommand, preferredOrigin = null) => {
    const command = normalizeCommand(rawCommand);
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
      notifyWorkspaceReady(target, preferredOrigin);
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
    const command = normalizeCommand(event?.data);
    if (!command) return;
    const channel = event?.data?.channel;
    if (channel && channel !== WORKSPACE_AUTH_CHANNEL) return;

    void receiver(command, event.origin).catch((error) => {
      console.error("[anatomy-lab] Workspace web auth handoff failed", error);
      notifyWorkspaceAuthResult(target, { accepted: false, signedIn: false, userId: null }, event.origin);
      notifyWorkspaceReady(target, event.origin);
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
      notifyWorkspaceReady(target, pending.origin);
    });
  }

  // Keep requesting the canonical session until Workspace answers. This makes
  // the bridge independent from iframe load timing, HMR remounts and mobile
  // browsers that suspend/resume the embedded page.
  const retryDelays = [0, 100, 300, 700, 1500, 3000, 6000, 10000, 15000];
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
