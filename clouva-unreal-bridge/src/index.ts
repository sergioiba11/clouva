import 'dotenv/config';

const unrealBaseUrl = process.env.UNREAL_REMOTE_URL ?? 'http://127.0.0.1:30010';
const presetName = process.env.UNREAL_PRESET_NAME ?? 'RC_CLOUVA_Avatar';
const actorName = process.env.UNREAL_ACTOR_NAME ?? 'BP_ClouvaCharacter';
const clouvaBaseUrl = process.env.CLOUVA_APP_URL;
const bridgeToken = process.env.CLOUVA_BRIDGE_TOKEN;
const intervalMs = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 15000);

type JsonRecord = Record<string, unknown>;

type AvatarSnapshot = {
  schemaVersion: 1;
  preset: string;
  actor: {
    name: string;
    label: string | null;
    path: string | null;
    transform: unknown;
    scale: unknown;
    skeletalMesh: unknown;
    skeleton: unknown;
    physicsAsset: unknown;
    materials: unknown[];
    bounds: unknown;
    sockets: unknown[];
    morphTargets: unknown[];
    bones: unknown[];
    exposedProperties: JsonRecord;
  };
  connection: {
    status: 'online';
    connectedAt: string;
    remoteUrl: string;
  };
  capturedAt: string;
  source: {
    info: unknown;
    presets: unknown;
    preset: unknown;
  };
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findValue(root: unknown, names: string[]): unknown {
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const queue: unknown[] = [root];
  const seen = new Set<object>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (wanted.has(normalized)) return value;
      queue.push(value);
    }
  }
  return null;
}

function collectExposedProperties(preset: unknown): JsonRecord {
  const output: JsonRecord = {};
  const queue: unknown[] = [preset];
  const seen = new Set<object>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as JsonRecord;
    const label = record.DisplayName ?? record.displayName ?? record.Label ?? record.label ?? record.PropertyName ?? record.propertyName;
    const value = record.Value ?? record.value ?? record.PropertyValue ?? record.propertyValue;
    if (typeof label === 'string' && value !== undefined) output[label] = value;
    queue.push(...Object.values(record));
  }
  return output;
}

function normalizeSnapshot(info: unknown, presets: unknown, preset: unknown): AvatarSnapshot {
  const exposedProperties = collectExposedProperties(preset);
  const actorCandidate = findValue(preset, ['BP_ClouvaCharacter', actorName, 'ActorLabel', 'ActorName']);
  const actorLabel = typeof actorCandidate === 'string' ? actorCandidate : actorName;
  const now = new Date().toISOString();
  const asArray = (value: unknown) => Array.isArray(value) ? value : value == null ? [] : [value];

  return {
    schemaVersion: 1,
    preset: presetName,
    actor: {
      name: actorName,
      label: actorLabel,
      path: (findValue(preset, ['ActorPath', 'ObjectPath', 'Path']) as string | null) ?? null,
      transform: findValue(preset, ['Transform', 'RelativeTransform', 'ActorTransform']),
      scale: findValue(preset, ['Scale3D', 'RelativeScale3D', 'Scale']),
      skeletalMesh: findValue(preset, ['SkeletalMesh', 'SkeletalMeshAsset']),
      skeleton: findValue(preset, ['Skeleton']),
      physicsAsset: findValue(preset, ['PhysicsAsset']),
      materials: asArray(findValue(preset, ['Materials', 'OverrideMaterials', 'MaterialSlots'])),
      bounds: findValue(preset, ['Bounds', 'LocalBounds', 'WorldBounds']),
      sockets: asArray(findValue(preset, ['Sockets', 'SocketNames'])),
      morphTargets: asArray(findValue(preset, ['MorphTargets', 'MorphTargetNames'])),
      bones: asArray(findValue(preset, ['Bones', 'BoneNames', 'ReferenceSkeleton'])),
      exposedProperties,
    },
    connection: { status: 'online', connectedAt: now, remoteUrl: unrealBaseUrl },
    capturedAt: now,
    source: { info, presets, preset },
  };
}

async function getJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${unrealBaseUrl}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Unreal respondió HTTP ${response.status} en ${path}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function capture(): Promise<AvatarSnapshot> {
  const [info, presets, preset] = await Promise.all([
    getJson('/remote/info'),
    getJson('/remote/presets'),
    getJson(`/remote/preset/${encodeURIComponent(presetName)}`),
  ]);
  return normalizeSnapshot(info, presets, preset);
}

async function sendSnapshot(snapshot: AvatarSnapshot): Promise<void> {
  if (!clouvaBaseUrl) throw new Error('Falta CLOUVA_APP_URL');
  if (!bridgeToken) throw new Error('Falta CLOUVA_BRIDGE_TOKEN');
  const response = await fetch(`${clouvaBaseUrl.replace(/\/$/, '')}/api/unreal/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bridgeToken}`,
    },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw new Error(`CLOUVA respondió HTTP ${response.status}: ${await response.text()}`);
}

async function runOnce(): Promise<void> {
  try {
    const snapshot = await capture();
    await sendSnapshot(snapshot);
    console.log(`[online] Snapshot enviado ${snapshot.capturedAt}`);
    console.log(JSON.stringify(snapshot, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[offline] ${new Date().toISOString()} ${message}`);
  }
}

console.log(`clouva-unreal-bridge iniciado. Unreal: ${unrealBaseUrl}; preset: ${presetName}; solo lectura.`);
await runOnce();
setInterval(runOnce, Math.max(intervalMs, 5000));
