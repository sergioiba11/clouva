import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROJECT = "gen-lang-client-0737053175";
const DEFAULT_ZONE = "southamerica-east1-b";
const DEFAULT_INSTANCE = "clouva-minecraft";
const RATE_LIMIT_MS = 8_000;

let lastStartRequestAt = 0;

async function getAccessToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("Cloud Run no pudo obtener credenciales para encender Minecraft.");
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google Cloud no devolvió un token válido.");
  return payload.access_token;
}

export async function POST(request: NextRequest) {
  try {
    await requireUser(request);

    const now = Date.now();
    if (now - lastStartRequestAt < RATE_LIMIT_MS) {
      return NextResponse.json(
        { ok: true, state: "starting", message: "El encendido ya fue solicitado." },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    lastStartRequestAt = now;

    const project =
      process.env.MINECRAFT_VM_PROJECT?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.CLOUVA_GCP_PROJECT?.trim() ||
      DEFAULT_PROJECT;
    const zone = process.env.MINECRAFT_VM_ZONE?.trim() || DEFAULT_ZONE;
    const instance = process.env.MINECRAFT_VM_NAME?.trim() || DEFAULT_INSTANCE;
    const token = await getAccessToken();

    const url =
      "https://compute.googleapis.com/compute/v1/projects/" +
      encodeURIComponent(project) +
      "/zones/" +
      encodeURIComponent(zone) +
      "/instances/" +
      encodeURIComponent(instance) +
      "/start";

    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      name?: string;
      status?: string;
      error?: { message?: string };
    };

    const message = payload.error?.message || "";
    if (!response.ok && !/already running|running/i.test(message)) {
      throw new Error(message || "Google Cloud rechazó el encendido del servidor.");
    }

    return NextResponse.json(
      {
        ok: true,
        state: "starting",
        operation: payload.name ?? null,
        instance,
        zone,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo prender el servidor.";
    return NextResponse.json(
      { error: message },
      {
        status: isAuthError(error) ? 401 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
