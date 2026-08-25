export type AgentTransport = "text" | "live";

export type AgentRunStatus =
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type TrebolSelectedElement = {
  selector: string;
  tag: string;
  text?: string;
  ariaLabel?: string;
  componentHint?: string;
  boundingRect?: Record<string, number>;
};

export type TrebolRuntimeContext = {
  user?: {
    id?: string;
  };
  navigation: {
    route: string;
    pathname: string;
    params: Record<string, string>;
    url: string;
  };
  active: {
    playerId?: string;
    avatarId?: string;
    studioId?: string;
    productId?: string;
    assetId?: string;
    creatorProjectId?: string;
  };
  ui: {
    selectedElement?: TrebolSelectedElement;
  };
  runtime: {
    errors: Array<Record<string, unknown>>;
    warnings: Array<Record<string, unknown>>;
    activeJobIds: string[];
  };
  project: {
    repository?: string;
    branch?: string;
    activeFile?: string;
  };
  /** Page-owned, short-lived context registered through the global provider. */
  scopes: Record<string, Record<string, unknown>>;
};

export type TrebolContextPatch = Record<string, unknown>;

export type AgentRunRecord = {
  id: string;
  persisted: boolean;
  conversationId: string;
  transport: AgentTransport;
};

export type AgentConversation = {
  id: string;
  studioId: string | null;
};
