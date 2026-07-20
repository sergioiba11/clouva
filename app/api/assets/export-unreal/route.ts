import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { finalizeClothingItem } from "@/lib/clothing-finalization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_BUCKET = "avatars";
const ALLOWED_SOURCE_BUCKETS = new Set(["avatars", "creator-assets"]);
const SKELETAL_CATEGORIES = new Set(["hoodie", "shirt", "jacket", "pants", "shorts", "shoes"]);
const DEFAULT_TARGET_HEIGHT_CM = 175;

// Altura visual aproximada de cada prenda respecto del cuerpo completo.
// El exportador de avatar normaliza el objeto recibido a target_height_cm;
// por eso una prenda no puede recibir la altura total del personaje.
const GARMENT_HEIGHT_RATIO: Record<string, number> = {
  hoodie: 0.43,
  shirt: 0.38,
  jacket: 0.46,
  pants: 0.59,
  shorts: 0.31,
  shoes: 0.13,
};

const GARMENT_HEIGHT_LIMITS_CM: Record<string, [number, number]> = {
  hoodie: [58, 88],
  shirt: [52, 78],
  jacket: [62, 92],
  pants: [82, 115],
  shorts: [38, 62],
  shoes: [14, 28],
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireUser(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sesión requerida");
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Sesión inválida");
  return { supabase, user: data.user };
}

function safeName(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 70) || "objeto";
}

function numericHeight(row: Record<string, unknown> | null | undefined) {
  if (!row) return DEFAULT_TARGET_HEIGHT_CM;
  for (const key of ["height_cm", "target_height_cm", "avatar_height_cm", "user_height_cm"]) {
    const raw = row[key];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(value) && value >= 80 && value <= 260) return value;
  }
  return DEFAULT_TARGET_HEIGHT_CM;
}

function garmentTargetHeightCm(category: string, avatarHeightCm: number) {
  const ratio = GARMENT_HEIGHT_RATIO[category] ?? 0.43;
  const [minimum, maximum] = GARMENT_HEIGHT_LIMITS_CM[category] ?? [45, 115];
  return Math.round(Math.min(maximum, Math.max(minimum, avatarHeightCm * ratio)) * 10) / 10;
}

type ActiveAvatarContext = {
  id: string | null;
  targetHeightCm: number;
};

async function activeAvatarContext(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<ActiveAvatarContext> {
  const { data } = await supabase
    .from("user_avatars")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    id: data?.id ? String(data.id) : null,
    targetHeightCm: numericHeight(data as Record<string, unknown> | null),
  };
}

function parseWorkerMetadata(response: Response) {
  const raw = response.headers.get("x-clouva-metadata");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  if (cause && typeof cause === "object") {
    const value = cause as Record<string, unknown>;
    for (const key of ["message", "error", "details", "detail", "hint"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return fallback;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const { data, error } = await supabase
      .from("clothing_items")
      .select("id,name,category,status,model_url,thumbnail_url,rigged,fit_status,updated_at")
      .eq("user_id", user.id)
      .eq("status", "ready")
      .not("model_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    return NextResponse.json({
      items: (data ?? []).map((item) => {
        const category = String(item.category || "accessory");
        const skeletalRequired = SKELETAL_CATEGORIES.has(category);
        const actuallyRigged = item.rigged === true && item.fit_status === "fitted";
        return {
          id: item.id,
          name: item.name || "Objeto CLOUVA",
          category,
          modelUrl: item.model_url,
          thumbnailUrl: item.thumbnail_url,
          rigged: actuallyRigged,
          fitStatus: item.fit_status,
          exportMode: skeletalRequired ? (actuallyRigged ? "skeletal" : "auto-rig") : "static",
        };
      }),
    });
  } catch (cause) {
    const message = errorMessage(cause, "No se pudieron cargar los objetos");
    const status = /sesión/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const body = (await request.json()) as {
      bucket?: string;
      path?: string;
      name?: string;
      clothingItemId?: string;
    };

    let sourceUrl = "";
    let assetName = String(body.name || "objeto.glb");
    let category = "prop";
    let skeletalExport = false;
    let selectedClothingItemId: string | null = null;

    if (body.clothingItemId) {
      const { data: item, error: itemError } = await supabase
        .from("clothing_items")
        .select("id,name,category,status,model_url,rigged,fit_status,color,metadata")
        .eq("id", body.clothingItemId)
        .eq("user_id", user.id)
        .single();

      if (itemError || !item) {
        return NextResponse.json({ error: "No encontramos esa pieza del usuario" }, { status: 404 });
      }
      if (item.status !== "ready" || !item.model_url) {
        return NextResponse.json({ error: "La pieza todavía no está lista" }, { status: 409 });
      }

      selectedClothingItemId = String(item.id);
      assetName = String(item.name || body.name || "pieza-clouva");
      category = String(item.category || "accessory");
      skeletalExport = SKELETAL_CATEGORIES.has(category);
      sourceUrl = String(item.model_url);

      const actuallyRigged = item.rigged === true && item.fit_status === "fitted";
      if (skeletalExport && !actuallyRigged) {
        const rerigged = await finalizeClothingItem({
          supabase,
          userId: user.id,
          itemId: String(item.id),
          modelUrl: sourceUrl,
          category,
          color: typeof item.color === "string" ? item.color : null,
          metadata: item.metadata && typeof item.metadata === "object"
            ? (item.metadata as Record<string, unknown>)
            : {},
        });

        if (!rerigged.rigged || !rerigged.item?.model_url) {
          throw new Error(
            rerigged.warning ||
            "No se pudo riggear automáticamente la prenda con el esqueleto del avatar activo.",
          );
        }
        sourceUrl = String(rerigged.item.model_url);
      }

      if (!sourceUrl.startsWith("https://")) {
        return NextResponse.json({ error: "La pieza no tiene una URL GLB válida" }, { status: 409 });
      }
    } else {
      const bucket = String(body.bucket || "");
      const path = String(body.path || "");
      if (!ALLOWED_SOURCE_BUCKETS.has(bucket)) {
        return NextResponse.json({ error: "Bucket no permitido" }, { status: 400 });
      }
      if (!path.startsWith(`${user.id}/`) || !/\.glb$/i.test(path)) {
        return NextResponse.json({ error: "El objeto no pertenece al usuario o no es GLB" }, { status: 400 });
      }

      const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 15);
      if (signed.error || !signed.data?.signedUrl) {
        throw signed.error || new Error("No se pudo firmar el GLB");
      }
      sourceUrl = signed.data.signedUrl;
      assetName = String(body.name || path.split("/").pop() || "objeto.glb");
    }

    const workerUrl = process.env.BLENDER_WORKER_URL?.replace(/\/+$/, "");
    if (!workerUrl) {
      return NextResponse.json({ error: "Falta BLENDER_WORKER_URL" }, { status: 503 });
    }

    const avatar = await activeAvatarContext(supabase, user.id);
    const avatarHeightCm = avatar.targetHeightCm;
    const targetHeightCm = skeletalExport
      ? garmentTargetHeightCm(category, avatarHeightCm)
      : avatarHeightCm;
    const workerEndpoint = skeletalExport ? "/export/unreal-v2" : "/export/unreal-object";
    const workerPayload = skeletalExport
      ? {
          avatar_id: avatar.id || selectedClothingItemId || `garment-${user.id}`,
          asset_id: selectedClothingItemId,
          user_id: user.id,
          source_url: sourceUrl,
          target_height_cm: targetHeightCm,
          avatar_height_cm: avatarHeightCm,
          garment_target_height_cm: targetHeightCm,
          asset_type: "garment",
          category,
          preserve_armature: true,
          preserve_skin_weights: true,
        }
      : {
          source_url: sourceUrl,
          asset_name: assetName,
          category,
          target_height_cm: targetHeightCm,
          wearable: false,
          require_skeletal: false,
          preserve_armature: false,
          preserve_skin_weights: false,
          export_object_types: ["MESH"],
        };

    const worker = await fetch(`${workerUrl}${workerEndpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BLENDER_WORKER_TOKEN
          ? { Authorization: `Bearer ${process.env.BLENDER_WORKER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(workerPayload),
      cache: "no-store",
    });

    if (!worker.ok) {
      const detail = await worker.text().catch(() => "");
      throw new Error(
        `El Blender Worker rechazó el objeto (${worker.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`,
      );
    }

    const bytes = await worker.arrayBuffer();
    if (bytes.byteLength < 128) throw new Error("El FBX del objeto está vacío");

    const metadata = parseWorkerMetadata(worker);
    if (skeletalExport && metadata?.readyForUnreal !== true) {
      throw new Error("La prenda no superó la validación de escala y esqueleto para Unreal.");
    }
    if (skeletalExport && metadata?.skeletal === false) {
      throw new Error("El Blender Worker devolvió una malla estática. La prenda necesita Armature y skin weights para Unreal.");
    }

    const base = safeName(assetName);
    const exportRevision = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const filename = `${base}-${skeletalExport ? "skeletal-" : ""}unreal-${exportRevision}.fbx`;
    const storagePath = `${user.id}/unreal-objects/${filename}`;
    const upload = await supabase.storage.from(OUTPUT_BUCKET).upload(storagePath, bytes, {
      contentType: "application/octet-stream",
      cacheControl: "0",
      upsert: false,
    });
    if (upload.error) {
      throw new Error(errorMessage(upload.error, "No se pudo guardar el FBX en Supabase"));
    }

    const publicUrl = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(storagePath).data.publicUrl;
    const url = `${publicUrl}?v=${encodeURIComponent(exportRevision)}`;
    const calibrated =
      (skeletalExport && metadata?.readyForUnreal === true) ||
      metadata?.calibratedToAvatar === true ||
      worker.headers.get("x-clouva-scale") === "avatar-calibrated";

    return NextResponse.json({
      ok: true,
      url,
      filename,
      path: storagePath,
      bucket: OUTPUT_BUCKET,
      metadata,
      exportMode: skeletalExport ? "skeletal-category-calibrated" : "static",
      avatarHeightCm,
      targetHeightCm,
      scale: calibrated
        ? skeletalExport
          ? `${category} calibrado a ${targetHeightCm} cm para avatar de ${avatarHeightCm} cm · Import Scale 1`
          : `calibrado al avatar de ${avatarHeightCm} cm · Import Scale 1`
        : "escala original preservada · centímetros Unreal",
    });
  } catch (cause) {
    const message = errorMessage(cause, "No se pudo exportar el objeto para Unreal");
    const status = /sesión/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
