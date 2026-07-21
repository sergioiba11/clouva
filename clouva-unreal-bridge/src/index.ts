import 'dotenv/config';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const unrealBaseUrl = process.env.UNREAL_REMOTE_URL ?? 'http://127.0.0.1:30010';
const presetName = process.env.UNREAL_PRESET_NAME ?? 'RC_CLOUVA_Avatar';
const actorName = process.env.UNREAL_ACTOR_NAME ?? 'BP_ClouvaCharacter';
const clouvaBaseUrl = process.env.CLOUVA_APP_URL;
const bridgeToken = process.env.CLOUVA_BRIDGE_TOKEN;
const intervalMs = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 15000);
const dryRun = process.env.DRY_RUN?.toLowerCase() === 'true';
const projectDir = process.env.UNREAL_PROJECT_DIR ? resolve(process.env.UNREAL_PROJECT_DIR) : null;
const currentDir = dirname(fileURLToPath(import.meta.url));
const templatePythonDir = resolve(currentDir, '../unreal/Content/Python');

type JsonRecord = Record<string, unknown>;
type ImportCommand = {
  id: string;
  source_url: string;
  filename: string;
  destination_path: string;
  command_type: string;
};

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
  connection: { status: 'online'; connectedAt: string; remoteUrl: string };
  capturedAt: string;
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
      if (wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return value;
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

function findExposedActor(preset: unknown): JsonRecord | null {
  const groups = isRecord(preset) && isRecord(preset.Preset) && Array.isArray(preset.Preset.Groups) ? preset.Preset.Groups : [];
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.ExposedActors)) continue;
    for (const actor of group.ExposedActors) {
      if (!isRecord(actor)) continue;
      const underlying = isRecord(actor.UnderlyingActor) ? actor.UnderlyingActor : null;
      if (actor.DisplayName === actorName || underlying?.Name === actorName) return actor;
    }
  }
  return null;
}

function normalizeSnapshot(preset: unknown): AvatarSnapshot {
  const exposedProperties = collectExposedProperties(preset);
  const exposedActor = findExposedActor(preset);
  const underlyingActor = exposedActor && isRecord(exposedActor.UnderlyingActor) ? exposedActor.UnderlyingActor : null;
  const actorLabel = typeof exposedActor?.DisplayName === 'string' ? exposedActor.DisplayName : actorName;
  const now = new Date().toISOString();
  const asArray = (value: unknown) => Array.isArray(value) ? value : value == null ? [] : [value];
  return {
    schemaVersion: 1,
    preset: presetName,
    actor: {
      name: actorName,
      label: actorLabel,
      path: typeof underlyingActor?.Path === 'string' ? underlyingActor.Path : null,
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
  const [, , preset] = await Promise.all([
    getJson('/remote/info'),
    getJson('/remote/presets'),
    getJson(`/remote/preset/${encodeURIComponent(presetName)}`),
  ]);
  return normalizeSnapshot(preset);
}

function apiHeaders() {
  if (!bridgeToken) throw new Error('Falta CLOUVA_BRIDGE_TOKEN');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeToken}` };
}

async function sendSnapshot(snapshot: AvatarSnapshot): Promise<void> {
  if (!clouvaBaseUrl) throw new Error('Falta CLOUVA_APP_URL');
  const response = await fetch(`${clouvaBaseUrl.replace(/\/$/, '')}/api/unreal/snapshot`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw new Error(`CLOUVA respondió HTTP ${response.status}: ${await response.text()}`);
}

async function updateCommand(id: string, status: string, progress: number, extra: JsonRecord = {}) {
  if (!clouvaBaseUrl) throw new Error('Falta CLOUVA_APP_URL');
  const response = await fetch(`${clouvaBaseUrl.replace(/\/$/, '')}/api/unreal/commands`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ id, status, progress, ...extra }),
  });
  if (!response.ok) throw new Error(`No se pudo actualizar el comando ${id}: ${await response.text()}`);
}

async function nextCommand(): Promise<ImportCommand | null> {
  if (!clouvaBaseUrl || dryRun) return null;
  const response = await fetch(`${clouvaBaseUrl.replace(/\/$/, '')}/api/unreal/commands`, { headers: apiHeaders() });
  if (!response.ok) throw new Error(`No se pudo consultar la cola Unreal: ${await response.text()}`);
  const data = await response.json() as { command?: ImportCommand | null };
  return data.command ?? null;
}

async function ensureImporterInstalled() {
  if (!projectDir) throw new Error('Falta UNREAL_PROJECT_DIR en clouva-unreal-bridge/.env');
  const destination = resolve(projectDir, 'Content/Python');
  await mkdir(destination, { recursive: true });
  for (const name of ['init_unreal.py', 'clouva_importer.py']) {
    const source = resolve(templatePythonDir, name);
    if (!existsSync(source)) throw new Error(`Falta plantilla Unreal ${source}`);
    await copyFile(source, resolve(destination, name));
  }
  await mkdir(resolve(projectDir, 'Saved/ClouvaInbox'), { recursive: true });
  await mkdir(resolve(projectDir, 'Saved/ClouvaOutbox'), { recursive: true });
}

async function processCommand(command: ImportCommand) {
  try {
    await ensureImporterInstalled();
    await updateCommand(command.id, 'downloading', 20);
    const response = await fetch(command.source_url);
    if (!response.ok) throw new Error(`No se pudo descargar FBX (${response.status})`);
    const inbox = resolve(projectDir!, 'Saved/ClouvaInbox');
    const localFbx = resolve(inbox, `${command.id}.fbx`);
    await writeFile(localFbx, Buffer.from(await response.arrayBuffer()));
    await updateCommand(command.id, 'importing', 65);
    await writeFile(resolve(inbox, `${command.id}.json`), JSON.stringify({
      id: command.id,
      type: command.command_type,
      filePath: localFbx,
      destinationPath: command.destination_path,
    }, null, 2), 'utf8');

    const resultPath = resolve(projectDir!, 'Saved/ClouvaOutbox', `${command.id}.json`);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (existsSync(resultPath)) {
        const result = JSON.parse(await readFile(resultPath, 'utf8')) as JsonRecord;
        const ok = result.ok === true;
        await updateCommand(command.id, ok ? 'succeeded' : 'failed', 100, ok ? { result } : { error: String(result.error ?? 'Unreal rechazó la importación'), result });
        console.log(`[unreal-import] ${command.id} ${ok ? 'completado' : 'falló'}`);
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    throw new Error('Unreal no procesó la bandeja en 120 segundos. Reiniciá el editor para cargar init_unreal.py.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateCommand(command.id, 'failed', 100, { error: message }).catch(() => undefined);
    console.error(`[unreal-import] ${command.id} ${message}`);
  }
}

let running = false;
async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const snapshot = await capture();
    if (!dryRun) await sendSnapshot(snapshot);
    else console.log(`[dry-run] Snapshot capturado ${snapshot.capturedAt}`);
    const command = await nextCommand();
    if (command) await processCommand(command);
    console.log(`[online] Snapshot enviado ${snapshot.capturedAt}`);
  } catch (error) {
    console.error(`[offline] ${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    running = false;
  }
}

console.log(`clouva-unreal-bridge iniciado. Unreal: ${unrealBaseUrl}; preset: ${presetName}; bidireccional; proyecto: ${projectDir ?? 'SIN CONFIGURAR'}; dry-run: ${dryRun}.`);
await runOnce();
setInterval(runOnce, Math.max(intervalMs, 5000));
