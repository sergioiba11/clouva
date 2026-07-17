export const RIG_JOB_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

const activeStates = new Set([
  "queued",
  "pending",
  "processing",
  "running",
  "started",
  "working",
  "in_progress",
]);

const activityKeys = [
  "updatedAt",
  "updated_at",
  "lastUpdatedAt",
  "last_updated_at",
  "lastActivityAt",
  "last_activity_at",
  "heartbeatAt",
  "heartbeat_at",
  "stageUpdatedAt",
  "stage_updated_at",
  "progressUpdatedAt",
  "progress_updated_at",
  "startedAt",
  "started_at",
  "createdAt",
  "created_at",
] as const;

export type RigJobWatchdogResult = {
  enabled: boolean;
  expired: boolean;
  timeoutMs: number;
  lastActivityAt: string | null;
  inactivityMs: number | null;
};

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    return milliseconds > 0 ? milliseconds : null;
  }

  if (typeof value !== "string" || !value.trim()) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return parseTimestamp(numeric);

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectCandidates(data: Record<string, unknown>) {
  const candidates: Record<string, unknown>[] = [data];
  for (const key of ["job", "meta", "metadata", "timing"] as const) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      candidates.push(value as Record<string, unknown>);
    }
  }
  return candidates;
}

export function extractRigJobActivityAt(
  data: Record<string, unknown>,
  now = Date.now(),
): number | null {
  const timestamps: number[] = [];

  for (const candidate of objectCandidates(data)) {
    for (const key of activityKeys) {
      const parsed = parseTimestamp(candidate[key]);
      if (parsed !== null && parsed <= now + 60_000) timestamps.push(parsed);
    }
  }

  return timestamps.length ? Math.max(...timestamps) : null;
}

export function evaluateRigJobWatchdog(args: {
  status: string;
  data: Record<string, unknown>;
  now?: number;
  timeoutMs?: number;
}): RigJobWatchdogResult {
  const now = args.now ?? Date.now();
  const timeoutMs = args.timeoutMs ?? RIG_JOB_INACTIVITY_TIMEOUT_MS;
  const status = args.status.trim().toLowerCase();

  if (!activeStates.has(status)) {
    return {
      enabled: false,
      expired: false,
      timeoutMs,
      lastActivityAt: null,
      inactivityMs: null,
    };
  }

  const lastActivityMs = extractRigJobActivityAt(args.data, now);
  if (lastActivityMs === null) {
    return {
      enabled: false,
      expired: false,
      timeoutMs,
      lastActivityAt: null,
      inactivityMs: null,
    };
  }

  const inactivityMs = Math.max(0, now - lastActivityMs);
  return {
    enabled: true,
    expired: inactivityMs >= timeoutMs,
    timeoutMs,
    lastActivityAt: new Date(lastActivityMs).toISOString(),
    inactivityMs,
  };
}
