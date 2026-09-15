import { NextRequest, NextResponse } from "next/server";
import { generateGroundedWithFallback } from "@/lib/clouva-ai/gemini-grounded";
import { selectedModelFromRequest } from "@/lib/clouva-ai/gemini-text";
import {
  acquireKnowledgeRefreshLock,
  buildKnowledgeSpec,
  knowledgeTopicFrom,
  readKnowledgeInsight,
  releaseKnowledgeRefreshLock,
  writeKnowledgeInsight,
} from "@/lib/knowledge/grounded-knowledge";
import type { PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

const KNOWLEDGE_INSTRUCTION =
  "Sos CLOUVA AI en modo Conocimiento. Tu tarea es enseñar, no llenar espacio. Buscá en la web cuando corresponda, priorizá fuentes verificables, explicá con ejemplos y separá hechos observables de tradiciones interpretativas. Nunca inventes una fuente, una observación actual ni una imagen real.";

type RefreshBody = {
  alias?: string;
  topic?: string;
  force?: boolean;
};

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let playerResolutionMs = 0;
  let profileMs = 0;
  let cacheMs = 0;
  let lockMs = 0;
  let geminiMs = 0;
  let dbWriteMs = 0;
  let lock:
    | { acquired: true; token: string }
    | { acquired: false; token: null }
    | null = null;
  let playerId = "";
  let subjectKey = "";
  let topicForLog: string | null = null;

  try {
    const body = (await request.json().catch(() => ({}))) as RefreshBody;
    const alias = body.alias?.trim() || "";
    const topic = knowledgeTopicFrom(body.topic);
    topicForLog = topic;
    if (!alias || !topic) {
      return NextResponse.json({ error: "Falta alias o tema." }, { status: 400 });
    }

    const playerStartedAt = Date.now();
    const resolved = await resolvePlayerAlias(alias).catch(() => null);
    playerResolutionMs = Date.now() - playerStartedAt;
    if (!resolved || !resolved.player.is_published || resolved.player.privacy_status === "private") {
      return NextResponse.json({ error: "Player no disponible." }, { status: 404 });
    }
    playerId = resolved.player.id;

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
    subjectKey = spec.subjectKey;

    const cacheStartedAt = Date.now();
    const existing = await readKnowledgeInsight(admin, resolved.player.id, topic, spec);
    cacheMs = Date.now() - cacheStartedAt;

    if (!body.force && existing.state === "fresh") {
      console.info("KNOWLEDGE_PERF", {
        route: "insight:refresh",
        topic,
        outcome: "already-fresh",
        playerResolutionMs,
        profileMs,
        cacheMs,
        totalMs: Date.now() - startedAt,
      });
      return NextResponse.json({ ...existing, refreshAccepted: false });
    }

    const lockStartedAt = Date.now();
    lock = await acquireKnowledgeRefreshLock(admin, resolved.player.id, topic, spec);
    lockMs = Date.now() - lockStartedAt;

    if (!lock.acquired) {
      const latest = await readKnowledgeInsight(admin, resolved.player.id, topic, spec);
      console.info("KNOWLEDGE_PERF", {
        route: "insight:refresh",
        topic,
        outcome: "deduplicated",
        playerResolutionMs,
        profileMs,
        cacheMs,
        lockMs,
        totalMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { ...latest, refreshing: true, refreshAccepted: false },
        { status: 202 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await releaseKnowledgeRefreshLock(
        admin,
        resolved.player.id,
        topic,
        spec.subjectKey,
        lock.token,
      );
      lock = null;
      return NextResponse.json(
        { error: "CLOUVA AI no tiene configurada la clave de Gemini." },
        { status: 503 },
      );
    }

    const geminiStartedAt = Date.now();
    const result = await generateGroundedWithFallback({
      apiKey,
      selectedModel: selectedModelFromRequest(request),
      instruction: KNOWLEDGE_INSTRUCTION,
      prompt: spec.prompt,
      maxOutputTokens: 1800,
      primaryTimeoutMs: 16_000,
      fallbackTimeoutMs: 9_000,
    });
    geminiMs = Date.now() - geminiStartedAt;

    const writeStartedAt = Date.now();
    const fresh = await writeKnowledgeInsight({
      admin,
      playerId: resolved.player.id,
      topic,
      spec,
      content: result.text,
      sources: result.sources,
      model: result.model,
      generatedAt: new Date(),
    });
    dbWriteMs = Date.now() - writeStartedAt;
    lock = null;

    console.info("KNOWLEDGE_PERF", {
      route: "insight:refresh",
      topic,
      outcome: "refreshed",
      playerResolutionMs,
      profileMs,
      cacheMs,
      lockMs,
      geminiMs,
      dbWriteMs,
      totalMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ...fresh, refreshAccepted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar esta data.";

    if (lock?.acquired && playerId && topicForLog && subjectKey) {
      const admin = createAdminSupabase();
      const topic = knowledgeTopicFrom(topicForLog);
      if (topic) {
        await releaseKnowledgeRefreshLock(admin, playerId, topic, subjectKey, lock.token).catch(
          (releaseError) => console.error("KNOWLEDGE_REFRESH_LOCK_RELEASE_FAILED", releaseError),
        );
      }
    }

    console.error("KNOWLEDGE_PERF", {
      route: "insight:refresh",
      topic: topicForLog,
      outcome: "failed",
      playerResolutionMs,
      profileMs,
      cacheMs,
      lockMs,
      geminiMs,
      dbWriteMs,
      totalMs: Date.now() - startedAt,
      error: message,
    });

    const status =
      /tardó demasiado|no respond|unavailable|temporarily|high demand/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
