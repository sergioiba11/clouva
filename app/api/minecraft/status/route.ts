import net from "node:net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VarIntRead = { value: number; size: number };
type MinecraftStatus = {
  version?: { name?: string };
  description?: unknown;
  players?: { online?: number; max?: number; sample?: Array<{ name?: string | null } | null> };
};

function encodeVarInt(input: number) {
  const bytes: number[] = [];
  let value = input >>> 0;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset = 0): VarIntRead | null {
  let value = 0;
  let position = 0;
  while (position < 5) {
    if (offset + position >= buffer.length) return null;
    const current = buffer[offset + position];
    value |= (current & 0x7f) << (7 * position);
    position += 1;
    if (!(current & 0x80)) return { value, size: position };
  }
  throw new Error("VarInt inválido");
}

function encodeString(value: string) {
  const buffer = Buffer.from(value);
  return Buffer.concat([encodeVarInt(buffer.length), buffer]);
}

function statusText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;

  const record = value as { text?: unknown; extra?: unknown[] };
  const parts: string[] = [];
  if (typeof record.text === "string") parts.push(record.text);

  for (const item of Array.isArray(record.extra) ? record.extra : []) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const nested = (item as { text?: unknown }).text;
      if (typeof nested === "string") parts.push(nested);
    }
  }
  return parts.join("").trim() || null;
}

async function queryMinecraft(host: string, port: number) {
  const startedAt = Date.now();

  return await new Promise<{
    latencyMs: number;
    version: string | null;
    motd: string | null;
    players: { online: number; max: number; sample: string[] };
  }>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let received = Buffer.alloc(0);
    let done = false;

    function finish(error?: Error, value?: {
      latencyMs: number;
      version: string | null;
      motd: string | null;
      players: { online: number; max: number; sample: string[] };
    }) {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      if (!value) {
        reject(new Error("Respuesta vacía"));
        return;
      }
      resolve(value);
    }

    socket.setTimeout(3000);
    socket.on("timeout", () => finish(new Error("timeout")));
    socket.on("error", (error) => finish(error));
    socket.on("connect", () => {
      const portBuffer = Buffer.allocUnsafe(2);
      portBuffer.writeUInt16BE(port);
      const handshake = Buffer.concat([
        encodeVarInt(0),
        encodeVarInt(0),
        encodeString(host),
        portBuffer,
        encodeVarInt(1),
      ]);
      socket.write(Buffer.concat([
        encodeVarInt(handshake.length),
        handshake,
        Buffer.from([1, 0]),
      ]));
    });

    socket.on("data", (chunk) => {
      try {
        received = Buffer.concat([received, chunk]);
        const packetLength = readVarInt(received);
        if (!packetLength || received.length < packetLength.size + packetLength.value) return;

        const packet = received.subarray(
          packetLength.size,
          packetLength.size + packetLength.value,
        );
        const packetId = readVarInt(packet);
        if (!packetId || packetId.value !== 0) throw new Error("Respuesta inesperada");

        const jsonLength = readVarInt(packet, packetId.size);
        if (!jsonLength) return;
        const jsonStart = packetId.size + jsonLength.size;
        if (packet.length < jsonStart + jsonLength.value) return;

        const parsed = JSON.parse(
          packet.subarray(jsonStart, jsonStart + jsonLength.value).toString(),
        ) as MinecraftStatus;

        finish(undefined, {
          latencyMs: Date.now() - startedAt,
          version: parsed.version?.name ?? null,
          motd: statusText(parsed.description),
          players: {
            online: Number(parsed.players?.online ?? 0),
            max: Number(parsed.players?.max ?? 0),
            sample: Array.isArray(parsed.players?.sample)
              ? parsed.players.sample
                  .map((player) => player?.name)
                  .filter((name): name is string => Boolean(name))
              : [],
          },
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Respuesta inválida"));
      }
    });
  });
}

export async function GET() {
  const host = process.env.MINECRAFT_HOST?.trim() || null;
  const javaPort = Number(process.env.MINECRAFT_JAVA_PORT || 25565);
  const bedrockPort = Number(process.env.MINECRAFT_BEDROCK_PORT || 19132);
  const publicJavaHost = process.env.MINECRAFT_PUBLIC_JAVA_HOST?.trim() || host;
  const publicBedrockHost = process.env.MINECRAFT_PUBLIC_BEDROCK_HOST?.trim() || host;
  const rawMapUrl = process.env.MINECRAFT_MAP_URL?.trim() || "/minecraft/map/";
  // BlueMap ships relative ./assets URLs. Next redirects directory URLs without
  // a trailing slash, which would make those assets resolve under /minecraft/assets
  // instead of /minecraft/map/assets. Point at index.html so the relative base stays
  // inside the proxied BlueMap path and the embedded app can boot correctly.
  const mapUrl = rawMapUrl.endsWith("/") ? `${rawMapUrl}index.html` : rawMapUrl;

  if (!host) {
    return NextResponse.json({
      configured: false,
      online: false,
      host,
      publicJavaHost,
      publicBedrockHost,
      javaPort,
      bedrockPort,
      mapUrl,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    return NextResponse.json({
      configured: true,
      online: true,
      host,
      publicJavaHost,
      publicBedrockHost,
      javaPort,
      bedrockPort,
      mapUrl,
      ...(await queryMinecraft(host, javaPort)),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      online: false,
      host,
      publicJavaHost,
      publicBedrockHost,
      javaPort,
      bedrockPort,
      mapUrl,
      error: error instanceof Error ? error.message : "No se pudo consultar Minecraft",
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
