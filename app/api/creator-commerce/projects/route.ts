import { NextRequest, NextResponse } from "next/server";
import { assertCreatorSellerAccess } from "@/lib/creator-commerce/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OwnerType = "player" | "studio" | "user" | "clouva";
type CreativeMode = "from_scratch" | "exact_design" | "reference";

const OWNER_TYPES = new Set<OwnerType>(["player", "studio", "user", "clouva"]);
const CREATIVE_MODES = new Set<CreativeMode>(["from_scratch", "exact_design", "reference"]);

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireUser(request);
    const { data, error } = await supabase
      .from("commerce_creator_projects")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return NextResponse.json({ projects: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los proyectos." }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = short(body.name, 180);
    if (!name) return NextResponse.json({ error: "El nombre del proyecto es obligatorio." }, { status: 400 });

    const ownerType = OWNER_TYPES.has(body.owner_type as OwnerType) ? body.owner_type as OwnerType : "user";
    const creativeMode = CREATIVE_MODES.has(body.creative_mode as CreativeMode) ? body.creative_mode as CreativeMode : "from_scratch";
    const playerId = ownerType === "player" ? short(body.player_id, 80) : "";
    const studioId = ownerType === "studio" ? short(body.studio_id, 80) : "";
    const spotId = short(body.spot_id, 80) || null;

    await assertCreatorSellerAccess(supabase, user.id, {
      ownerType,
      playerId: playerId || null,
      studioId: studioId || null,
      spotId,
    });

    const row = {
      user_id: user.id,
      owner_type: ownerType,
      player_id: playerId || null,
      studio_id: studioId || null,
      spot_id: spotId,
      name,
      collection_name: short(body.collection_name, 180) || null,
      category: short(body.category, 120) || "Merch",
      product_template: short(body.product_template, 120) || null,
      creative_mode: creativeMode,
      brief: short(body.brief, 4000) || null,
      source_type: short(body.source_type, 80) || null,
      source_ref: short(body.source_ref, 500) || null,
      design_system: asRecord(body.design_system),
      metadata: asRecord(body.metadata),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("commerce_creator_projects")
      .insert(row)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ project: data }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear el proyecto." }, { status });
  }
}
