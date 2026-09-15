import { NextRequest, NextResponse } from "next/server";
import {
  buildKnowledgeSpec,
  knowledgeTopicFrom,
  readKnowledgeInsight,
} from "@/lib/knowledge/grounded-knowledge";
import type { PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  let playerResolutionMs = 0;
  let profileMs = 0;
  let cacheMs = 0;

  try {
    const alias = request.nextUrl.searchParams.get("alias")?.trim() || "";
    const topic = knowledgeTopicFrom(request.nextUrl.searchParams.get("topic"));
    if (!alias || !topic) {
      return NextResponse.json({ error: "Falta alias o tema." }, { status: 400 });
    }

    const playerStartedAt = Date.now();
    const resolved = await resolvePlayerAlias(alias).catch(() => null);
    playerResolutionMs = Date.now() - playerStartedAt;
    if (!resolved || !resolved.player.is_published || resolved.player.privacy_status === "private") {
      return NextResponse.json({ error: "Player no disponible." }, { status: 404 });
    }

    const admin = createAdminSupabase();
    const profileStartedAt = Date.now();
    const profileResult = await admin
      .from("player_knowledge_profiles")
      .select("*")
      .eq("player_id", resolved.player.id)
      .maybeSingle();
    profileMs = Date.now() - profileStartedAt;
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (!profileResult.data) {
      return NextResponse.json({ error: "Este Player todavía no configuró Conocimiento." }, { status: 404 });
    }

    const profile = profileResult.data as PlayerKnowledgeProfile;
    const spec = buildKnowledgeSpec(topic, profile);

    const cacheStartedAt = Date.now();
    const insight = await readKnowledgeInsight(admin, resolved.player.id, topic, spec);
    cacheMs = Date.now() - cacheStartedAt;

    console.info("KNOWLEDGE_PERF", {
      route: "insight:get",
      topic,
      state: insight.state,
      playerResolutionMs,
      profileMs,
      cacheMs,
      totalMs: Date.now() - startedAt,
    });

    return NextResponse.json(insight, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar esta data.";
    const status = message.startsWith("Este Player") ? 404 : 500;
    console.error("KNOWLEDGE_PERF", {
      route: "insight:get",
      playerResolutionMs,
      profileMs,
      cacheMs,
      totalMs: Date.now() - startedAt,
      error: message,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
