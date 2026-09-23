import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createAdminSupabase,
  isAuthError,
  requireUser,
} from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROJECT = "gen-lang-client-0737053175";
const DEFAULT_ZONE = "southamerica-east1-b";
const DEFAULT_INSTANCE = "clouva-minecraft";
const COMMAND_METADATA_KEY = "ratcraft-command";

type InstanceMetadataItem = { key?: string; value?: string };
type InstancePayload = {
  name?: string;
  status?: string;
  machineType?: string;
  networkInterfaces?: Array<{
    accessConfigs?: Array<{ natIP?: string }>;
  }>;
  metadata?: {
    fingerprint?: string;
    items?: InstanceMetadataItem[];
  };
};

const COMMAND_ACTIONS = new Set([
  "whitelist_add",
  "whitelist_remove",
  "whitelist_on",
  "whitelist_off",
  "whitelist_list",
  "op",
  "deop",
  "kick",
  "ban",
  "pardon",
  "gamemode",
  "teleport",
  "difficulty",
  "time",
  "weather",
  "say",
  "save_all",
  "list",
]);

async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,role_v2")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (profile?.role !== "admin" && profile?.role_v2 !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }

  return { user };
}

function config() {
  return {
    project:
      process.env.MINECRAFT_VM_PROJECT?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.CLOUVA_GCP_PROJECT?.trim() ||
      DEFAULT_PROJECT,
    zone: process.env.MINECRAFT_VM_ZONE?.trim() || DEFAULT_ZONE,
    instance: process.env.MINECRAFT_VM_NAME?.trim() || DEFAULT_INSTANCE,
  };
}

async function getAccessToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("Cloud Run no pudo obtener credenciales de Google Cloud.");
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google Cloud no devolvió un token válido.");
  return payload.access_token;
}

async function computeRequest<T>(
  suffix: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  const { project, zone, instance } = config();
  const token = await getAccessToken();
  const url =
    "https://compute.googleapis.com/compute/v1/projects/" +
    encodeURIComponent(project) +
    "/zones/" +
    encodeURIComponent(zone) +
    "/instances/" +
    encodeURIComponent(instance) +
    suffix;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };

  if (!response.ok) {
    const message = payload.error?.message || "Google Cloud rechazó la operación.";
    if (!/already running|already stopped/i.test(message)) throw new Error(message);
  }

  return payload;
}

async function getInstance() {
  return computeRequest<InstancePayload>("");
}

function instanceSummary(instance: InstancePayload) {
  const ip =
    instance.networkInterfaces?.flatMap((item) => item.accessConfigs ?? [])
      .map((item) => item.natIP)
      .find(Boolean) ?? null;

  return {
    name: instance.name ?? config().instance,
    status: instance.status ?? "UNKNOWN",
    ip,
    machineType: instance.machineType?.split("/").pop() ?? null,
  };
}

async function queueCommand(
  action: string,
  args: Record<string, unknown>,
  actorId: string,
) {
  const instance = await getInstance();
  const fingerprint = instance.metadata?.fingerprint;
  if (!fingerprint) throw new Error("La VM no devolvió fingerprint de metadata.");

  const command = {
    id: randomUUID(),
    action,
    args,
    actorId,
    issuedAt: new Date().toISOString(),
  };

  const currentItems = Array.isArray(instance.metadata?.items)
    ? instance.metadata!.items!
    : [];

  const items = currentItems
    .filter((item) => item.key && item.key !== COMMAND_METADATA_KEY)
    .map((item) => ({ key: item.key!, value: item.value ?? "" }));

  items.push({
    key: COMMAND_METADATA_KEY,
    value: JSON.stringify(command),
  });

  await computeRequest("/setMetadata", "POST", {
    fingerprint,
    items,
  });

  return command;
}

async function waitForStatus(expected: string, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await getInstance();
    if (current.status === expected) return current;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("La VM tardó demasiado en cambiar de estado.");
}

function cleanArgs(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {} as Record<string, unknown>;
  }
  return input as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const instance = await getInstance();
    return NextResponse.json(
      { ok: true, server: instanceSummary(instance) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      (error as Error & { status?: number })?.status ??
      (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo leer Ratcraft." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const body = (await request.json().catch(() => null)) as
      | { action?: unknown; args?: unknown }
      | null;

    const action = typeof body?.action === "string" ? body.action.trim() : "";
    const args = cleanArgs(body?.args);

    if (!action) {
      return NextResponse.json({ error: "Falta la acción." }, { status: 400 });
    }

    if (action === "start") {
      const before = await getInstance();
      if (before.status !== "RUNNING") {
        await computeRequest("/start", "POST");
      }
      return NextResponse.json({ ok: true, action, state: "starting" });
    }

    if (action === "stop") {
      const before = await getInstance();
      if (before.status === "RUNNING") {
        await queueCommand("save_all", {}, user.id).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await computeRequest("/stop", "POST");
      }
      return NextResponse.json({ ok: true, action, state: "stopping" });
    }

    if (action === "restart") {
      const before = await getInstance();
      if (before.status === "RUNNING") {
        await queueCommand("save_all", {}, user.id).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await computeRequest("/stop", "POST");
        await waitForStatus("TERMINATED");
      }
      await computeRequest("/start", "POST");
      return NextResponse.json({ ok: true, action, state: "starting" });
    }

    if (!COMMAND_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Acción de Ratcraft no permitida." }, { status: 400 });
    }

    const command = await queueCommand(action, args, user.id);
    return NextResponse.json(
      { ok: true, queued: true, command: { id: command.id, action: command.action } },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      (error as Error & { status?: number })?.status ??
      (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo ejecutar la herramienta de Ratcraft.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
