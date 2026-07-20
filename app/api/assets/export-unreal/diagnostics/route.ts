import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUser(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sesión requerida");
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Sesión inválida");
  return { supabase, user: data.user };
}

function firstHttps(row: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.startsWith("https://")) return value;
  }
  return null;
}

async function activeAvatarUrl(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
) {
  const { data: avatar } = await supabase
    .from("user_avatars")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const avatarUrl = firstHttps(avatar as Record<string, unknown> | null, [
    "processed_glb_url",
    "rigged_url",
    "model_url",
  ]);
  if (avatarUrl) return avatarUrl;

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();
  return firstHttps(profile as Record<string, unknown> | null, ["avatar_3d_url"]);
}

function readableWorkerError(raw: string, status: number) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const detail = parsed.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  } catch {
    // The Worker may return plain text on infrastructure failures.
  }
  return raw.trim() || `El Worker no pudo completar el diagnóstico (${status})`;
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const body = (await request.json()) as {
      clothingItemId?: string;
      runPipeline?: boolean;
    };
    if (!body.clothingItemId) {
      return NextResponse.json({ error: "Elegí una prenda para inspeccionar" }, { status: 400 });
    }

    const { data: item, error: itemError } = await supabase
      .from("clothing_items")
      .select("id,name,category,status,model_url")
      .eq("id", body.clothingItemId)
      .eq("user_id", user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: "No encontramos esa prenda" }, { status: 404 });
    }
    if (item.status !== "ready" || typeof item.model_url !== "string") {
      return NextResponse.json({ error: "La prenda todavía no tiene un GLB listo" }, { status: 409 });
    }

    const avatarUrl = await activeAvatarUrl(supabase, user.id);
    if (!avatarUrl) {
      return NextResponse.json({ error: "No encontramos el GLB del avatar activo" }, { status: 409 });
    }

    const workerUrl = process.env.BLENDER_WORKER_URL?.replace(/\/+$/, "");
    if (!workerUrl) {
      return NextResponse.json({ error: "Falta BLENDER_WORKER_URL" }, { status: 503 });
    }

    const worker = await fetch(`${workerUrl}/diagnostics/garment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BLENDER_WORKER_TOKEN
          ? { Authorization: `Bearer ${process.env.BLENDER_WORKER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        source_url: item.model_url,
        avatar_source_url: avatarUrl,
        user_id: user.id,
        category: item.category || "hoodie",
        run_pipeline: body.runPipeline !== false,
      }),
      cache: "no-store",
    });

    const raw = await worker.text();
    if (!worker.ok) {
      return NextResponse.json(
        { error: readableWorkerError(raw, worker.status), workerStatus: worker.status },
        { status: worker.status >= 500 ? 502 : 422 },
      );
    }

    const diagnostics = JSON.parse(raw) as Record<string, unknown>;
    return NextResponse.json({
      ...diagnostics,
      clothingItem: {
        id: item.id,
        name: item.name,
        category: item.category,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "No se pudo abrir el Inspector del Worker";
    return NextResponse.json(
      { error: message },
      { status: /sesión/i.test(message) ? 401 : 500 },
    );
  }
}
