import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { makeUniqueStructureSlug, normalizeRuleList } from "@/lib/structures/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la operación.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("structures")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) throw new Error("No se pudieron cargar las estructuras.");

    const projects = await Promise.all((data ?? []).map(async (structure) => {
      const { count } = await admin
        .from("structure_images")
        .select("id", { count: "exact", head: true })
        .eq("structure_id", structure.id);
      return { ...structure, image_count: count ?? 0 };
    }));

    return NextResponse.json({ projects });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) throw new Error("Poné un nombre para la estructura.");

    const rules = normalizeRuleList(body.reconstructionRules);
    const slug = await makeUniqueStructureSlug(admin, user.id, name);
    const { data, error } = await admin
      .from("structures")
      .insert({
        owner_id: user.id,
        name,
        slug,
        structure_type: typeof body.structureType === "string" && body.structureType.trim()
          ? body.structureType.trim().slice(0, 80)
          : "building",
        description: typeof body.description === "string" ? body.description.trim().slice(0, 3000) || null : null,
        location_name: typeof body.locationName === "string" ? body.locationName.trim().slice(0, 240) || null : null,
        historical_notes: typeof body.historicalNotes === "string" ? body.historicalNotes.trim().slice(0, 5000) || null : null,
        reconstruction_rules: rules,
        status: "draft",
      })
      .select("*")
      .single();
    if (error || !data) throw new Error("No se pudo crear la estructura.");

    if (rules.length) {
      await admin.from("structure_rules").insert(
        rules.map((rule, index) => ({
          structure_id: data.id,
          rule,
          priority: 100 - index,
          active: true,
        })),
      );
    }

    return NextResponse.json({ structure: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
