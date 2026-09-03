import { NextRequest, NextResponse } from "next/server";
import {
  calculateNumerologyNumber,
  normalizeKnowledgeTopics,
  zodiacSignFromBirthDate,
  type PlayerKnowledgeProfile,
} from "@/lib/knowledge/player-knowledge";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findEditablePlayer(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const owned = await admin.from("players").select("id,slug,display_name").eq("owner_user_id", userId).maybeSingle();
  if (owned.error) throw new Error(owned.error.message);
  if (owned.data) return owned.data;

  const membership = await admin
    .from("player_members")
    .select("player_id,role")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (membership.error) throw new Error(membership.error.message);
  if (!membership.data) return null;

  const player = await admin.from("players").select("id,slug,display_name").eq("id", membership.data.player_id).maybeSingle();
  if (player.error) throw new Error(player.error.message);
  return player.data;
}

function validBirthDate(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("La fecha de nacimiento no es válida.");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("La fecha de nacimiento no es válida.");
  if (date.getTime() > Date.now()) throw new Error("La fecha de nacimiento no puede estar en el futuro.");
  return value;
}

function view(profile: PlayerKnowledgeProfile | null, player: { id: string; slug: string; display_name: string }) {
  return {
    player,
    profile,
    derived: {
      numerologyNumber: profile?.show_numerology ? calculateNumerologyNumber(profile.birth_date) : null,
      zodiacSign: profile?.show_zodiac ? zodiacSignFromBirthDate(profile.birth_date) : null,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await findEditablePlayer(admin, user.id);
    if (!player) return NextResponse.json({ error: "No pudimos resolver tu Player." }, { status: 404 });

    const result = await admin.from("player_knowledge_profiles").select("*").eq("player_id", player.id).maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json(view((result.data as PlayerKnowledgeProfile | null) ?? null, player));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar Conocimiento." },
      { status: isAuthError(error) ? 401 : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await findEditablePlayer(admin, user.id);
    if (!player) return NextResponse.json({ error: "No pudimos resolver tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const birthDate = validBirthDate(body.birth_date);
    const knowledgeTopics = normalizeKnowledgeTopics(body.knowledge_topics);
    const teachTopics = normalizeKnowledgeTopics(body.teach_topics);
    const patch = {
      player_id: player.id,
      birth_date: birthDate,
      show_lunar: body.show_lunar === true,
      show_numerology: body.show_numerology === true,
      show_zodiac: body.show_zodiac === true,
      knowledge_topics: knowledgeTopics,
      teach_topics: teachTopics,
      updated_at: new Date().toISOString(),
    };

    if ((patch.show_numerology || patch.show_zodiac) && !patch.birth_date) {
      return NextResponse.json({ error: "Agregá tu fecha de nacimiento para calcular numerología y signo." }, { status: 400 });
    }

    const result = await admin
      .from("player_knowledge_profiles")
      .upsert(patch, { onConflict: "player_id" })
      .select("*")
      .single();
    if (result.error) throw new Error(result.error.message);

    return NextResponse.json(view(result.data as PlayerKnowledgeProfile, player));
  } catch (error) {
    const status = isAuthError(error) ? 401 : error instanceof Error && error.message.includes("fecha") ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar Conocimiento." }, { status });
  }
}
