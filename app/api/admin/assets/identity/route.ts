import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import {
  BRAND_IDENTITY_ROLE_COLUMNS,
  adminAssetSourceNote,
  gcsAdminAssetUrl,
  isBrandIdentityRole,
  roleAcceptsPath,
  safeAdminAssetPath,
  type AdminIdentityAssetSource,
  type BrandIdentityRole,
} from "@/lib/server/brand-engine/admin-asset-assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OwnerType = "studio" | "player";
type AssignmentInput = {
  source: AdminIdentityAssetSource;
  bucket: string;
  path: string;
  role: BrandIdentityRole;
};

type BrandAssetRow = {
  id: string;
  active_version_id: string | null;
};

type VersionRow = Record<string, unknown> & {
  id: string;
  primary_logo_url?: string | null;
  generation_metadata?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_SOURCES = new Set<AdminIdentityAssetSource>(["gcs", "supabase", "github"]);
const COPY_FIELDS = [
  "primary_logo_url", "symbol_logo_url", "horizontal_logo_url", "vertical_logo_url",
  "square_logo_url", "transparent_logo_url", "white_logo_url", "black_logo_url", "favicon_url",
  "master_svg_url", "symbol_svg_url", "horizontal_svg_url", "vertical_svg_url", "white_svg_url",
  "black_svg_url", "monochrome_svg_url", "print_pdf_url", "brand_config_url", "palette",
  "visual_analysis", "generation_metadata", "fingerprint", "standalone_symbol_available",
] as const;

let storage: Storage | null = null;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function parseOwnerType(value: unknown): OwnerType {
  if (value === "studio" || value === "player") return value;
  throw new MediaApiError("Tipo de identidad inválido.", 400, "invalid_owner_type");
}

function parseAssignments(value: unknown): AssignmentInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 30) {
    throw new MediaApiError("Elegí entre 1 y 30 assets para asignar.", 400, "invalid_assignments");
  }
  return value.map((raw) => {
    const item = recordOf(raw);
    const source = item.source;
    const bucket = typeof item.bucket === "string" ? item.bucket.trim() : "";
    const path = typeof item.path === "string" ? safeAdminAssetPath(item.path) : null;
    if (typeof source !== "string" || !SUPPORTED_SOURCES.has(source as AdminIdentityAssetSource)) {
      throw new MediaApiError("Storage de asset inválido.", 400, "invalid_asset_source");
    }
    if (!bucket || !path) throw new MediaApiError("Bucket o ruta de asset inválidos.", 400, "invalid_asset_path");
    if (!isBrandIdentityRole(item.role)) throw new MediaApiError("Rol semántico inválido.", 400, "invalid_semantic_role");
    if (!roleAcceptsPath(item.role, path)) {
      throw new MediaApiError(`El archivo ${path} no es compatible con el rol ${item.role}.`, 422, "role_format_mismatch");
    }
    return { source: source as AdminIdentityAssetSource, bucket, path, role: item.role };
  });
}

async function resolveOwner(admin: SupabaseClient, ownerType: OwnerType, ownerId: string) {
  if (!UUID_RE.test(ownerId)) throw new MediaApiError("Identidad inválida.", 400, "invalid_owner_id");
  if (ownerType === "studio") {
    const { data, error } = await admin.from("studios").select("id,name,slug").eq("id", ownerId).maybeSingle();
    if (error) throw new MediaApiError(`No se pudo leer el Studio: ${error.message}`, 502, "owner_lookup_failed");
    if (!data) throw new MediaApiError("El Studio no existe.", 404, "owner_not_found");
    return { id: String(data.id), name: String(data.name || data.slug || "Studio") };
  }
  const { data, error } = await admin.from("players").select("id,display_name,username,slug").eq("id", ownerId).maybeSingle();
  if (error) throw new MediaApiError(`No se pudo leer el Player: ${error.message}`, 502, "owner_lookup_failed");
  if (!data) throw new MediaApiError("El Player no existe.", 404, "owner_not_found");
  return { id: String(data.id), name: String(data.display_name || data.username || data.slug || "Player") };
}

async function stableAssetUrl(admin: SupabaseClient, assignment: AssignmentInput) {
  if (assignment.source === "gcs") {
    const [exists] = await getStorage().bucket(assignment.bucket).file(assignment.path).exists();
    if (!exists) throw new MediaApiError(`El asset ${assignment.path} ya no existe en Google Cloud.`, 404, "asset_not_found");
    return gcsAdminAssetUrl(assignment.bucket, assignment.path);
  }
  if (assignment.source === "supabase") {
    const { data: bucket, error } = await admin.storage.getBucket(assignment.bucket);
    if (error || !bucket) throw new MediaApiError("El bucket de Supabase no existe.", 404, "asset_bucket_not_found");
    if (!bucket.public) throw new MediaApiError("Una identidad oficial necesita una URL estable; este bucket de Supabase es privado.", 422, "private_asset_not_supported");
    const { data } = admin.storage.from(assignment.bucket).getPublicUrl(assignment.path);
    return data.publicUrl;
  }
  if (assignment.bucket !== "public" || !assignment.path.startsWith("public/")) {
    throw new MediaApiError("Solo se pueden vincular assets de Repo ubicados bajo public/.", 422, "github_asset_not_public");
  }
  return `/${assignment.path.slice("public/".length).split("/").map(encodeURIComponent).join("/")}`;
}

async function ensureBrandAsset(admin: SupabaseClient, ownerType: OwnerType, ownerId: string, ownerName: string, createdBy: string) {
  const { data: existing, error: lookupError } = await admin
    .from("brand_assets")
    .select("id,active_version_id")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .maybeSingle();
  if (lookupError) throw new MediaApiError(`No se pudo leer la identidad: ${lookupError.message}`, 502, "brand_lookup_failed");
  if (existing) return existing as BrandAssetRow;

  const { data, error } = await admin.from("brand_assets").insert({
    owner_type: ownerType,
    owner_id: ownerId,
    name: ownerName,
    status: "active",
    created_by: createdBy,
  }).select("id,active_version_id").single();
  if (error) throw new MediaApiError(`No se pudo crear la identidad: ${error.message}`, 502, "brand_create_failed");
  return data as BrandAssetRow;
}

async function readVersion(admin: SupabaseClient, versionId: string | null) {
  if (!versionId) return null;
  const { data, error } = await admin.from("brand_asset_versions").select("*").eq("id", versionId).maybeSingle();
  if (error) throw new MediaApiError(`No se pudo leer la versión activa: ${error.message}`, 502, "brand_version_lookup_failed");
  return data as VersionRow | null;
}

async function ensureManualDraft(admin: SupabaseClient, brandAsset: BrandAssetRow) {
  const { data: draft, error: draftError } = await admin
    .from("brand_asset_versions")
    .select("*")
    .eq("brand_asset_id", brandAsset.id)
    .eq("status", "draft")
    .eq("import_mode", "real_identity_import")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftError) throw new MediaApiError(`No se pudo leer el pack manual: ${draftError.message}`, 502, "manual_brand_lookup_failed");
  if (draft) return draft as VersionRow;

  const active = await readVersion(admin, brandAsset.active_version_id);
  const cloned: Record<string, unknown> = {};
  if (active) {
    for (const field of COPY_FIELDS) if (field in active) cloned[field] = active[field];
  }
  const metadata = recordOf(cloned.generation_metadata);
  cloned.generation_metadata = { ...metadata, provenance: "admin_assignment", manualBrandPack: true };

  const { data, error } = await admin.from("brand_asset_versions").insert({
    ...cloned,
    brand_asset_id: brandAsset.id,
    source_type: "uploaded_logo",
    source_mockup_url: null,
    import_mode: "real_identity_import",
    source_kind: "designer_delivery",
    source_note: "admin-assets identity assignment",
    status: "draft",
  }).select("*").single();
  if (error) throw new MediaApiError(`No se pudo crear el pack manual: ${error.message}`, 502, "manual_brand_create_failed");
  return data as VersionRow;
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireMediaAdmin(request);
    const [studiosResult, playersResult] = await Promise.all([
      admin.from("studios").select("id,name,slug").order("name", { ascending: true }).limit(500),
      admin.from("players").select("id,display_name,username,slug").order("display_name", { ascending: true }).limit(500),
    ]);
    if (studiosResult.error || playersResult.error) {
      throw new MediaApiError(studiosResult.error?.message ?? playersResult.error?.message ?? "No se pudieron leer las identidades.", 502, "owners_lookup_failed");
    }
    return NextResponse.json({
      studios: (studiosResult.data ?? []).map((row) => ({ id: row.id, name: row.name || row.slug || "Studio", slug: row.slug ?? null })),
      players: (playersResult.data ?? []).map((row) => ({ id: row.id, name: row.display_name || row.username || row.slug || "Player", slug: row.slug ?? null })),
    });
  } catch (error) {
    const result = publicMediaError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = recordOf(await request.json());
    const ownerType = parseOwnerType(body.ownerType);
    const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
    const assignments = parseAssignments(body.assignments);
    const publish = body.publish === true;
    const owner = await resolveOwner(admin, ownerType, ownerId);
    const brandAsset = await ensureBrandAsset(admin, ownerType, owner.id, owner.name, user.id);
    const draft = await ensureManualDraft(admin, brandAsset);

    const resolved = [] as Array<AssignmentInput & { url: string }>;
    for (const assignment of assignments) resolved.push({ ...assignment, url: await stableAssetUrl(admin, assignment) });

    const metadata = recordOf(draft.generation_metadata);
    const previousAssignments = arrayOfRecords(metadata.adminAssetAssignments).filter((item) => typeof item.role === "string" && !resolved.some((assignment) => assignment.role === item.role));
    const assignmentMetadata = resolved.map((assignment) => ({
      role: assignment.role,
      source: assignment.source,
      bucket: assignment.bucket,
      path: assignment.path,
      url: assignment.url,
      assignedAt: new Date().toISOString(),
      assignedBy: user.id,
    }));
    const patch: Record<string, unknown> = {
      generation_metadata: { ...metadata, provenance: "admin_assignment", manualBrandPack: true, adminAssetAssignments: [...previousAssignments, ...assignmentMetadata] },
      source_note: resolved.map((assignment) => adminAssetSourceNote(assignment.source, assignment.bucket, assignment.path)).join(" | ").slice(0, 4000),
    };
    for (const assignment of resolved) patch[BRAND_IDENTITY_ROLE_COLUMNS[assignment.role]] = assignment.url;

    const { data: updated, error: updateError } = await admin.from("brand_asset_versions").update(patch).eq("id", draft.id).select("id,primary_logo_url").single();
    if (updateError) throw new MediaApiError(`No se pudo asociar el pack: ${updateError.message}`, 502, "brand_assignment_failed");

    let published = false;
    if (publish) {
      if (!updated.primary_logo_url) throw new MediaApiError("Asigná primero un asset con rol Primary antes de publicar el pack.", 422, "primary_logo_required");
      const { error: publishError } = await admin.rpc("publish_brand_asset_version", { p_version_id: draft.id });
      if (publishError) throw new MediaApiError(`No se pudo publicar el pack: ${publishError.message}`, 502, "brand_publish_failed");
      published = true;
    }

    return NextResponse.json({
      ok: true,
      ownerType,
      ownerId: owner.id,
      brandAssetId: brandAsset.id,
      brandAssetVersionId: draft.id,
      published,
      assignments: resolved.map(({ role, source, bucket, path }) => ({ role, source, bucket, path })),
    });
  } catch (error) {
    const result = publicMediaError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
