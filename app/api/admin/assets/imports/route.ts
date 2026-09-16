import { NextRequest, NextResponse } from "next/server";
import { requireMediaAdmin } from "@/lib/server/media-auth";
import {
  ASSET_IMPORT_MAX_ARCHIVE_BYTES,
  createImportJob,
  listImportJobs,
} from "@/lib/admin-assets/import-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo preparar la importación.";
  if (/sesión|administrador|permisos/i.test(message)) return NextResponse.json({ error: message }, { status: 403 });
  if (/supera el límite/i.test(message)) return NextResponse.json({ error: message, code: "archive_too_large" }, { status: 413 });
  if (/acepta archivos ZIP|vacío/i.test(message)) return NextResponse.json({ error: message, code: "invalid_archive" }, { status: 400 });
  return NextResponse.json({ error: message.slice(0, 500), code: "asset_import_prepare_failed" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 12);
    const jobs = await listImportJobs(admin, user.id, limit);
    return NextResponse.json({ jobs });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json() as {
      filename?: unknown;
      size?: unknown;
      contentType?: unknown;
      destinationFolder?: unknown;
    };
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const size = Number(body.size ?? 0);
    const contentType = typeof body.contentType === "string" ? body.contentType.trim() : "application/zip";
    const destinationFolder = typeof body.destinationFolder === "string" ? body.destinationFolder : "uploads";
    if (!filename) return NextResponse.json({ error: "Falta el nombre del ZIP.", code: "filename_required" }, { status: 400 });
    if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: "El ZIP está vacío.", code: "empty_archive" }, { status: 400 });
    if (size > ASSET_IMPORT_MAX_ARCHIVE_BYTES) {
      return NextResponse.json({
        error: `El ZIP supera el límite de ${Math.round(ASSET_IMPORT_MAX_ARCHIVE_BYTES / 1024 / 1024)} MB.`,
        code: "archive_too_large",
      }, { status: 413 });
    }

    const prepared = await createImportJob({
      admin,
      userId: user.id,
      filename,
      size,
      contentType,
      destinationFolder,
      origin: request.headers.get("origin") ?? request.nextUrl.origin,
    });
    return NextResponse.json(prepared, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
