import { NextRequest, NextResponse } from "next/server";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;
const KINDS = new Set([
  "cover",
  "logo",
  "artwork",
  "artwork_master",
  "moodboard",
  "reference",
  "product_reference",
  "inspiration_reference",
]);

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseDataUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Falta la imagen.");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("La imagen no tiene un formato válido.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new Error("Usá JPG, PNG o WEBP.");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("La imagen puede pesar hasta 8 MB.");
  return { mimeType, bytes };
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: unknown;
      kind?: unknown;
      label?: unknown;
      dataUrl?: unknown;
    };
    const projectId = short(body.projectId, 80);
    if (!projectId) return NextResponse.json({ error: "Falta el proyecto." }, { status: 400 });
    const project = await supabase.from("commerce_creator_projects").select("id").eq("id", projectId).maybeSingle();
    if (project.error) throw new Error(project.error.message);
    if (!project.data) return NextResponse.json({ error: "El proyecto no existe o no tenés permiso." }, { status: 404 });

    const kind = KINDS.has(String(body.kind)) ? String(body.kind) : "reference";
    const parsed = parseDataUrl(body.dataUrl);
    const stored = await uploadGeneratedMediaObject({
      bytes: parsed.bytes,
      mimeType: parsed.mimeType,
      pathPrefix: `creator-commerce/${user.id}/${projectId}/identity/${kind}`,
    });
    return NextResponse.json({
      asset: {
        kind,
        label: short(body.label, 120) || kind,
        url: stored.url,
        storagePath: stored.objectPath,
        mimeType: parsed.mimeType,
        status: "reference",
      },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 400);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo subir el asset." }, { status });
  }
}
