import { randomUUID } from "node:crypto";

const DEFAULT_PROJECT = "gen-lang-client-0737053175";
const DEFAULT_ZONE = "southamerica-east1-b";
const DEFAULT_INSTANCE = "clouva-minecraft";
const COMMAND_METADATA_KEY = "ratcraft-command-queue";

type InstanceMetadataItem = { key?: string; value?: string };
type InstancePayload = {
  metadata?: {
    fingerprint?: string;
    items?: InstanceMetadataItem[];
  };
};

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
    { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" },
  );
  if (!response.ok) throw new Error("Cloud Run no pudo obtener credenciales de Google Cloud.");
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google Cloud no devolvió un token válido.");
  return payload.access_token;
}

async function computeRequest<T>(suffix: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
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

  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "Google Cloud rechazó la operación.");
  return payload;
}

export async function queueRatcraftCommand(action: string, args: Record<string, unknown>, actorId: string) {
  const instance = await computeRequest<InstancePayload>("");
  const fingerprint = instance.metadata?.fingerprint;
  if (!fingerprint) throw new Error("La VM no devolvió fingerprint de metadata.");

  const command = {
    id: randomUUID(),
    action,
    args,
    actorId,
    issuedAt: new Date().toISOString(),
  };

  const currentItems = Array.isArray(instance.metadata?.items) ? instance.metadata!.items! : [];
  const queueItem = currentItems.find((item) => item.key === COMMAND_METADATA_KEY);
  let queue: Array<Record<string, unknown>> = [];

  if (queueItem?.value) {
    try {
      const parsed = JSON.parse(queueItem.value) as unknown;
      if (Array.isArray(parsed)) {
        queue = parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
      }
    } catch {
      queue = [];
    }
  }

  queue.push(command);
  queue = queue.slice(-20);

  const items = currentItems
    .filter((item) => item.key && item.key !== COMMAND_METADATA_KEY)
    .map((item) => ({ key: item.key!, value: item.value ?? "" }));

  items.push({ key: COMMAND_METADATA_KEY, value: JSON.stringify(queue) });
  await computeRequest("/setMetadata", "POST", { fingerprint, items });
  return command;
}
