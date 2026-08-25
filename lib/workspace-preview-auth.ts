import type { Session } from "@supabase/supabase-js";

export type WorkspacePreviewAuthSync =
  | {
      type: "signed-in";
      access_token: string;
      refresh_token: string;
    }
  | {
      type: "signed-out";
    };

type AuthResult = {
  data: { session: Session | null };
  error: { message: string } | null;
};

type SignOutResult = {
  error: { message: string } | null;
};

export type WorkspacePreviewAuthAdapter = {
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<AuthResult>;
  signOut: (options: { scope: "local" }) => Promise<SignOutResult>;
  stopAutoRefresh?: () => void;
};

export type WorkspacePreviewAuthBridge = {
  __CLOUVA_WORKSPACE_SYNC_SESSION__?: (
    command: WorkspacePreviewAuthSync,
  ) => Promise<{ accepted: boolean; signedIn: boolean; userId: string | null }>;
};

declare global {
  interface Window {
    __CLOUVA_WORKSPACE_SYNC_SESSION__?: WorkspacePreviewAuthBridge["__CLOUVA_WORKSPACE_SYNC_SESSION__"];
  }
}

type PreviewLocation = Pick<Location, "hostname" | "protocol">;

export function isWorkspacePreviewAuthBridgeAllowed(
  location: PreviewLocation,
  environment: string | undefined = process.env.NODE_ENV,
): boolean {
  return (
    environment === "development" &&
    location.protocol === "http:" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  );
}

function isValidSignedInCommand(
  command: WorkspacePreviewAuthSync,
): command is Extract<WorkspacePreviewAuthSync, { type: "signed-in" }> {
  return (
    command.type === "signed-in" &&
    typeof command.access_token === "string" &&
    command.access_token.length > 0 &&
    typeof command.refresh_token === "string" &&
    command.refresh_token.length > 0
  );
}

export async function applyWorkspacePreviewAuthSync(
  command: WorkspacePreviewAuthSync,
  auth: WorkspacePreviewAuthAdapter,
): Promise<{ accepted: boolean; signedIn: boolean; userId: string | null }> {
  if (command.type === "signed-out") {
    const result = await auth.signOut({ scope: "local" });
    if (result.error) throw new Error(result.error.message);
    return { accepted: true, signedIn: false, userId: null };
  }

  if (!isValidSignedInCommand(command)) {
    return { accepted: false, signedIn: false, userId: null };
  }

  const result = await auth.setSession({
    access_token: command.access_token,
    refresh_token: command.refresh_token,
  });
  if (result.error) throw new Error(result.error.message);
  // Electron main owns refresh-token rotation for an embedded Workspace
  // Preview. It pushes TOKEN_REFRESHED sessions back through this bridge;
  // keeping a second browser timer active can rotate the same token twice.
  auth.stopAutoRefresh?.();

  const userId = result.data.session?.user.id ?? null;
  return { accepted: Boolean(userId), signedIn: Boolean(userId), userId };
}

export function installWorkspacePreviewAuthBridge(options: {
  target: WorkspacePreviewAuthBridge;
  location: PreviewLocation;
  auth: WorkspacePreviewAuthAdapter;
  environment?: string;
}): () => void {
  const { target, location, auth, environment = process.env.NODE_ENV as string | undefined } = options;
  if (!isWorkspacePreviewAuthBridgeAllowed(location, environment)) return () => {};

  const receiver = (command: WorkspacePreviewAuthSync) => applyWorkspacePreviewAuthSync(command, auth);
  target.__CLOUVA_WORKSPACE_SYNC_SESSION__ = receiver;

  return () => {
    if (target.__CLOUVA_WORKSPACE_SYNC_SESSION__ === receiver) {
      delete target.__CLOUVA_WORKSPACE_SYNC_SESSION__;
    }
  };
}
