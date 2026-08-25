import type {
  TrebolContextPatch,
  TrebolRuntimeContext,
  TrebolSelectedElement,
} from "./types";

const MAX_TEXT = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 5;
const MAX_SERIALIZED_BYTES = 30_000;
const BLOCKED_KEY = /(?:^|_)(?:authorization|cookie|credential|password|secret|token|api[_-]?key|data[_-]?base64|html|model[_-]?url|signed[_-]?url)(?:$|_)/i;
const SIGNED_URL_QUERY = /(?:x-goog-signature|x-amz-signature|signature=|token=|sig=)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shortText(value: unknown, limit = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, limit);
}

function safeId(value: unknown): string | undefined {
  return shortText(value, 160);
}

function safeUrl(value: unknown): string {
  const raw = shortText(value, 1_000) ?? "";
  if (!raw || SIGNED_URL_QUERY.test(raw)) return "";
  try {
    const parsed = new URL(raw, "https://clouva.local");
    parsed.search = "";
    parsed.hash = "";
    return parsed.origin === "https://clouva.local" ? parsed.pathname : parsed.toString();
  } catch {
    return "";
  }
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null) return value === null ? null : undefined;
  if (typeof value === "string") {
    if (SIGNED_URL_QUERY.test(value)) return undefined;
    return shortText(value);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeUnknown(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return undefined;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (BLOCKED_KEY.test(key)) continue;
    const sanitized = sanitizeUnknown(item, depth + 1);
    if (sanitized !== undefined) output[key.slice(0, 80)] = sanitized;
  }
  return output;
}

function safeParams(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, item]) => [key.slice(0, 80), safeId(item)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function safeEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => sanitizeUnknown(item))
    .filter(isRecord);
}

function safeSelection(value: unknown): TrebolSelectedElement | undefined {
  if (!isRecord(value)) return undefined;
  const selector = shortText(value.selector, 500);
  const tag = shortText(value.tag, 40);
  if (!selector || !tag) return undefined;

  const rawRect = isRecord(value.boundingRect) ? value.boundingRect : {};
  const boundingRect = Object.fromEntries(
    Object.entries(rawRect)
      .slice(0, 8)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .map(([key, item]) => [key.slice(0, 30), Math.round(item * 100) / 100]),
  );

  return {
    selector,
    tag,
    text: shortText(value.text, 300),
    ariaLabel: shortText(value.ariaLabel, 200),
    componentHint: shortText(value.componentHint, 120),
    boundingRect: Object.keys(boundingRect).length ? boundingRect : undefined,
  };
}

export function emptyTrebolRuntimeContext(): TrebolRuntimeContext {
  return {
    navigation: { route: "", pathname: "", params: {}, url: "" },
    active: {},
    ui: {},
    runtime: { errors: [], warnings: [], activeJobIds: [] },
    project: {},
    scopes: {},
  };
}

/** Accepts only the documented runtime context and applies a hard size cap. */
export function buildTrebolRuntimeContext(value: unknown): TrebolRuntimeContext {
  const source = isRecord(value) ? value : {};
  const navigation = isRecord(source.navigation) ? source.navigation : {};
  const active = isRecord(source.active) ? source.active : {};
  const ui = isRecord(source.ui) ? source.ui : {};
  const runtime = isRecord(source.runtime) ? source.runtime : {};
  const project = isRecord(source.project) ? source.project : {};
  const rawScopes = isRecord(source.scopes) ? source.scopes : {};

  const scopes: Record<string, Record<string, unknown>> = {};
  for (const [scope, item] of Object.entries(rawScopes).slice(0, 20)) {
    const sanitized = sanitizeUnknown(item);
    if (isRecord(sanitized)) scopes[scope.slice(0, 120)] = sanitized;
  }

  const context: TrebolRuntimeContext = {
    user: isRecord(source.user) ? { id: safeId(source.user.id) } : undefined,
    navigation: {
      route: shortText(navigation.route, 300) ?? "",
      pathname: shortText(navigation.pathname, 300) ?? "",
      params: safeParams(navigation.params),
      url: safeUrl(navigation.url),
    },
    active: {
      playerId: safeId(active.playerId),
      avatarId: safeId(active.avatarId),
      studioId: safeId(active.studioId),
      productId: safeId(active.productId),
      assetId: safeId(active.assetId),
      creatorProjectId: safeId(active.creatorProjectId),
    },
    ui: { selectedElement: safeSelection(ui.selectedElement) },
    runtime: {
      errors: safeEntries(runtime.errors),
      warnings: safeEntries(runtime.warnings),
      activeJobIds: Array.isArray(runtime.activeJobIds)
        ? runtime.activeJobIds.slice(0, MAX_ARRAY_ITEMS).map(safeId).filter((item): item is string => Boolean(item))
        : [],
    },
    project: {
      repository: shortText(project.repository, 200),
      branch: shortText(project.branch, 160),
      activeFile: shortText(project.activeFile, 500),
    },
    scopes,
  };

  if (new TextEncoder().encode(JSON.stringify(context)).byteLength <= MAX_SERIALIZED_BYTES) return context;
  return { ...context, runtime: { errors: [], warnings: [], activeJobIds: context.runtime.activeJobIds }, scopes: {} };
}

function diffValue(previous: unknown, current: unknown): unknown {
  if (Object.is(previous, current)) return undefined;
  if (!isRecord(previous) || !isRecord(current)) {
    return JSON.stringify(previous) === JSON.stringify(current) ? undefined : current;
  }

  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (!(key in current)) {
      patch[key] = null;
      continue;
    }
    const nested = diffValue(previous[key], current[key]);
    if (nested !== undefined) patch[key] = nested;
  }
  return Object.keys(patch).length ? patch : undefined;
}

/** First sync is a full snapshot; later syncs contain changed fields only. */
export function diffTrebolRuntimeContext(
  previous: TrebolRuntimeContext | null,
  current: TrebolRuntimeContext,
): TrebolContextPatch {
  if (!previous) return current as unknown as TrebolContextPatch;
  const patch = diffValue(previous, current);
  return isRecord(patch) ? patch : {};
}

export function sanitizeAgentPayload(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeUnknown(value);
  return isRecord(sanitized) ? sanitized : {};
}
