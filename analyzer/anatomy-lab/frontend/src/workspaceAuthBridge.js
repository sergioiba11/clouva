function validSignedIn(command) {
  return command?.type === "signed-in"
    && typeof command.access_token === "string"
    && command.access_token.length > 0
    && typeof command.refresh_token === "string"
    && command.refresh_token.length > 0;
}

/** Receive the canonical Workspace session only through Electron's verified
 * local Preview handoff. Workspace remains the sole refresh-token owner. */
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
  return () => {
    if (target.__CLOUVA_WORKSPACE_SYNC_SESSION__ === receiver) {
      delete target.__CLOUVA_WORKSPACE_SYNC_SESSION__;
    }
  };
}
