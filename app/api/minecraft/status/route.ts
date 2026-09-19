import net from "node:net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VarIntResult = { value: number; size: number };

function encodeVarInt(input: number) {
  const bytes: number[] = [];
  let value = input >>> 0;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset = 0): VarIntResult | null {
  let value = 0;
  let position = 0;

  while (position < 5) {
    const index = offset + position;
    if (index >= buffer.length) return null;
    const current = buffer[index];
    value |= (current & 0x7f) << (7 * position);
    position += 1;
    if ((current & 0x80) === 0) return { value, size: position };
  }

  throw new Error("Minecraft VarInt inválido");
}

function minecraftString(value: string) {
  const body = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function plainTextDescription(description: unknown): string | null {
  if (typeof description === "string") return description;
  if (!description || typeof description !== "object") return null;

  const record = description as { text?: unknown; extra?: unknown[] };
  const chunks: string[] = [];
  if (typeof record.text === "string") chunks.push(record.text);
  if (Array.isArray(record.extra)) {
    for (const item of record.extra) {
      if (typeof item === "string") chunks.push(item);
      else if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
        chunks.push(String((item as { text: string }).text));
      }
    }
  }
  return chunks.join("").trim() || null;
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
    let settled = false;

    const finish = (error?: Error, value?: Parameters<typeof resolve>[0]) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else if (value) resolve(value);
    };

    socket.setTimeout(3000);
    socket.on("timeout", () => finish(new Error("timeout")));
    socket.on("error", (error) => finish(error));

    socket.on("connect", () => {
      const address = minecraftString(host);
      const portBuffer = Buffer.allocUnsafe(2);
      portBuffer.writeUInt16BE(port, 0);

      const handshakePayload = Buffer.concat([
        encodeVarInt(0),
        encodeVarInt(0),
        address,
        portBuffer,
        encodeVarInt(1),
      ]);
      const handshake = Buffer.concat([encodeVarInt(handshakePayload.length), handshakePayload]);
      const statusRequest = Buffer.from([0x01, 0x00]);
      socket.write(Buffer.concat([handshake, statusRequest]));
    });

    socket.on("data", (chunk) => {
      try {
        received = Buffer.concat([received, chunk]);
        const packetLength = readVarInt(received, 0);
        if (!packetLength) return;

        const packetStart = packetLength.size;
        if (received.length < packetStart + packetLength.value) return;

        const packet = received.subarray(packetStart, packetStart + packetLength.value);
        const packetId = readVarInt(packet, 0);
        if (!packetId || packetId.value !== 0) throw new Error("Respuesta Minecraft inesperada");

        const jsonLength = readVarInt(packet, packetId.size);
        if (!jsonLength) return;

        const jsonStart = packetId.size + jsonLength.size;
        const jsonEnd = jsonStart + jsonLength.value;
        if (packet.length < jsonEnd) return;

        const payload = JSON.parse(packet.subarray(jsonStart, jsonEnd).toString("utf8")) as {
          version?: { name?: string };
          description?: unknown;
          players?: {
            online?: number;
            max?: number;
            sample?: Array<{ name?: string }>;
          };
        };

        finish(undefined, {
          latencyMs: Date.now() - startedAt,
          version: payload.version?.name ?? null,
          motd: plainTextDescription(payload.description),
          players: {
            online: Number(payload.players?.online ?? 0),
            max: Number(payload.players?.max ?? 0),
            sample: Array.isArray(payload.players?.sample)
              ? payload.players!.sample!.map((player) => player.name).filter((name): name is string => Boolean(name))
              : [],
          },
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Respuesta Minecraft inválida"));
      }
    });
  });
}

export async function GET() {
  const host = process.env.MINECRAFT_HOST?.trim() || null;
  const javaPort = Number(process.env.MINECRAFT_JAVA_PORT || 25565);
  const bedrockPort = Number(process.env.MINECRAFT_BEDROCK_PORT || 19132);

  if (!host) {
    return NextResponse.json(
      { configured: false, online: false, host: null, javaPort, bedrockPort },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const status = await queryMinecraft(host, javaPort);
    return NextResponse.json(
      { configured: true, online: true, host, javaPort, bedrockPort, ...status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        online: false,
        host,
        javaPort,
        bedrockPort,
        error: error instanceof Error ? error.message : "No se pudo consultar Minecraft",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
