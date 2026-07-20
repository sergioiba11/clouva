import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPreviewTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CATEGORIES = new Set(["hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"]);

const CATEGORY_PROMPTS: Record<string, string> = {
  hoodie: "standalone hollow hoodie with neck opening, two sleeves, cuffs and hem",
  shirt: "standalone hollow T-shirt with neck opening, sleeves and torso shell",
  jacket: "standalone hollow jacket with sleeves, cuffs, collar and openable front",
  pants: "standalone hollow pants with waistband and two separated pant legs",
  shorts: "standalone hollow shorts with waistband and two separated leg openings",
  shoes: "standalone matched pair of shoes without feet or legs",
  accessory: "standalone wearable accessory without a mannequin or body",
};

type BodySection = {
  widthCm?: number;
  depthCm?: number;
  circumferenceApproxCm?: number;
};

type BodyContract = {
  ok?: boolean;
  version?: string;
  heightCm?: number;
  armSpanCm?: number;
  recommendedClearanceCm?: number;
  sections?: Record<string, BodySection>;
  garmentTarget?: Record<string, number>;
  worker?: Record<string, unknown>;
};

type ResolvedAvatar = {
  id: string;
  url: string;
  source: "user_avatars" | "profiles";
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["message", "details", "detail", "hint", "error"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return fallback;
}

async function resolveActiveAvatar(supabase: ReturnType<typeof getAdminClient>, userId: string): Promise<ResolvedAvatar> {
  const { data: active, error: activeError } = await supabase
    .from("user_avatars")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) throw new Error(errorMessage(activeError, "No se pudo consultar el avatar activo"));
  const activeUrl = typeof active?.processed_glb_url === "string" && active.processed_glb_url
    ? active.processed_glb_url
    : typeof active?.rigged_url === "string" && active.rigged_url
      ? active.rigged_url
      : typeof active?.model_url === "string" && active.model_url
        ? active.model_url
        : null;

  if (active?.id && activeUrl) return { id: String(active.id), url: activeUrl, source: "user_avatars" };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw new Error(errorMessage(profileError, "No se pudo consultar el avatar del perfil"));
  if (typeof profile?.avatar_3d_url === "string" && profile.avatar_3d_url) {
    return { id: `profile-${userId}`, url: profile.avatar_3d_url, source: "profiles" };
  }
  throw new Error("No hay un avatar activo procesado para medir");
}

async function requestBodyContract(avatarUrl: string, category: string): Promise<BodyContract> {
  const workerUrl = (process.env.GARMENT_RIG_WORKER_URL || process.env.BLENDER_WORKER_URL)?.replace(/\/+$/, "");
  const workerToken = process.env.GARMENT_RIG_WORKER_TOKEN || process.env.BLENDER_WORKER_TOKEN;
  if (!workerUrl) throw new Error("No está configurado el Blender Worker");

  const response = await fetch(`${workerUrl}/body-contract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
    },
    body: JSON.stringify({ avatar_source_url: avatarUrl, category }),
    cache: "no-store",
    signal: AbortSignal.timeout(4 * 60 * 1000),
  });

  const text = await response.text();
  let data: BodyContract & { detail?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text) as BodyContract & { detail?: string };
    } catch {
      throw new Error(`Blender devolvió una respuesta inválida (${response.status})`);
    }
  }
  if (!response.ok || !data.ok) throw new Error(data.detail || `Blender no pudo medir el cuerpo (${response.status})`);
  return data;
}

function number(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "unknown";
}

function bodyAwarePrompt(category: string, fit: string, color: string, description: string, contract: BodyContract) {
  const sections = contract.sections ?? {};
  const target = contract.garmentTarget ?? {};
  return [
    `Create a ${CATEGORY_PROMPTS[category] ?? CATEGORY_PROMPTS.accessory}.`,
    `Design: ${description}.`,
    `Fit ${fit || "regular"}; color ${color || "black"}.`,
    "Garment only: no person, mannequin, skin, head, hands, arms, legs or feet. Hollow, symmetrical, upright, clean connected topology and cloth thickness.",
    `Blender body measurements in cm: height ${number(contract.heightCm)}, chest ${number(sections.chest?.widthCm)}x${number(sections.chest?.depthCm)}, waist ${number(sections.waist?.widthCm)}x${number(sections.waist?.depthCm)}, hips ${number(sections.hips?.widthCm)}x${number(sections.hips?.depthCm)}, shoulders ${number(sections.shoulders?.widthCm)}.`,
    `Target shell in cm: chest ${number(target.chestWidthCm)}x${number(target.chestDepthCm)}, waist ${number(target.waistWidthCm)}, hips ${number(target.hipWidthCm)}, shoulders ${number(target.shoulderWidthCm)}; clearance ${number(contract.recommendedClearanceCm)}.`,
  ].join(" ").slice(0, 600);
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) return NextResponse.json({ error: "Iniciá sesión para ejecutar la prueba" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return NextResponse.json({ error: "La sesión no es válida o venció" }, { status: 401 });

    const body = await request.json();
    const category = String(body?.category ?? "hoodie").trim().toLowerCase();
    const description = String(body?.description ?? "").trim().slice(0, 240);
    const fit = String(body?.fit ?? "Regular").trim().slice(0, 40);
    const color = String(body?.color ?? "black").trim().slice(0, 40);
    const name = String(body?.name ?? "Prueba cuerpo → Meshy").trim().slice(0, 80) || "Prueba cuerpo → Meshy";

    if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Describí la pieza que querés probar" }, { status: 400 });

    const avatar = await resolveActiveAvatar(supabase, userData.user.id);
    const contract = await requestBodyContract(avatar.url, category);
    const prompt = bodyAwarePrompt(category, fit, color, description, contract);
    const taskId = await createPreviewTask(prompt, "cartoon");
    const itemId = crypto.randomUUID();

    const { data: item, error: insertError } = await supabase
      .from("clothing_items")
      .insert({
        id: itemId,
        user_id: userData.user.id,
        name,
        category,
        fit: fit || null,
        color: color || null,
        status: "generating",
        prompt,
        meshy_task_id: taskId,
        processing_started_at: new Date().toISOString(),
        fit_status: "pending",
        metadata: {
          generation_kind: "body-contract-text-to-3d",
          generation_stage: "preview",
          experiment: "blender-body-contract-to-meshy-v1",
          avatar_id: avatar.id,
          avatar_source: avatar.source,
          body_contract: contract,
          body_contract_version: contract.version ?? "body-contract-v1",
          requires_blender_finalization: true,
        },
      })
      .select("id,name,category,status,meshy_task_id,created_at")
      .single();

    if (insertError) throw new Error(errorMessage(insertError, "No se pudo guardar la prueba"));
    return NextResponse.json({ ok: true, taskId, item, bodyContract: contract, stage: "preview" });
  } catch (error) {
    console.error("Body contract to Meshy test failed", error);
    return NextResponse.json(
      { error: errorMessage(error, "No se pudo ejecutar la prueba cuerpo → Blender → Meshy") },
      { status: 500 },
    );
  }
}
