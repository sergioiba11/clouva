import { NextRequest, NextResponse } from "next/server";
import { generateGroundedWithFallback, type GroundedSource } from "@/lib/clouva-ai/gemini-grounded";
import { selectedModelFromRequest } from "@/lib/clouva-ai/gemini-text";
import { calculateNumerologyNumber, zodiacSignFromBirthDate, type PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

type Topic = "lunar" | "numerologia" | "astrologia";

type CachedInsight = {
  content: string;
  sources: GroundedSource[];
  model: string | null;
  generated_at: string;
  expires_at: string;
};

function topicFrom(value: string | null): Topic | null {
  return value === "lunar" || value === "numerologia" || value === "astrologia" ? value : null;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function buildPrompt(topic: Topic, profile: PlayerKnowledgeProfile) {
  const day = utcDay();
  if (topic === "lunar") {
    if (!profile.show_lunar) throw new Error("Este Player no publica conocimiento lunar.");
    return {
      title: "Data de la Luna",
      subjectKey: `lunar:${day}`,
      expiresHours: 8,
      prompt: `Fecha de referencia: ${day}. Buscá en la web información astronómica actual y verificable sobre la Luna para esta fecha. Resumí fase lunar, iluminación aproximada y cualquier evento lunar relevante sólo si una fuente lo confirma. Si agregás una lectura cultural, espiritual o astrológica, separala explícitamente de los datos astronómicos verificables. Respondé en español rioplatense claro, breve, sin inventar datos y sin pegar URLs en el cuerpo: las fuentes se muestran aparte.`,
    };
  }

  if (topic === "numerologia") {
    const number = calculateNumerologyNumber(profile.birth_date);
    if (!profile.show_numerology || number === null) throw new Error("Este Player no publica numerología.");
    return {
      title: `Número ${number}`,
      subjectKey: `numerologia:${number}`,
      expiresHours: 24 * 30,
      prompt: `El número calculado por suma de los dígitos de la fecha de nacimiento y reducción a un dígito es ${number}. Buscá fuentes web y explicá qué representa el número ${number} dentro de tradiciones numerológicas documentadas. Diferenciá con claridad qué es historia o práctica documentada y qué es interpretación simbólica; no presentes la numerología como un hecho científico. Respondé en español rioplatense, útil para una ficha educativa de CLOUVA, sin URLs en el cuerpo.`,
    };
  }

  const sign = zodiacSignFromBirthDate(profile.birth_date);
  if (!profile.show_zodiac || !sign) throw new Error("Este Player no publica astrología.");
  return {
    title: sign,
    subjectKey: `astrologia:${sign.toLocaleLowerCase("es")}:${day}`,
    expiresHours: 18,
    prompt: `El signo zodiacal tropical calculado por fecha de nacimiento es ${sign}. Fecha actual de referencia: ${day}. Buscá fuentes web actuales y prepará una ficha sobre ${sign}. Separá explícitamente: (1) datos astronómicos verificables relacionados con la constelación/cielo cuando sean relevantes y (2) asociaciones de la tradición astrológica. Para cualquier afirmación actual sobre el cielo, usá fuentes recientes. No presentes interpretaciones astrológicas como hechos científicos. Respondé en español rioplatense claro, sin URLs en el cuerpo.`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const alias = request.nextUrl.searchParams.get("alias")?.trim() || "";
    const topic = topicFrom(request.nextUrl.searchParams.get("topic"));
    if (!alias || !topic) return NextResponse.json({ error: "Falta alias o tema." }, { status: 400 });

    const resolved = await resolvePlayerAlias(alias).catch(() => null);
    if (!resolved || !resolved.player.is_published || resolved.player.privacy_status === "private") {
      return NextResponse.json({ error: "Player no disponible." }, { status: 404 });
    }

    const admin = createAdminSupabase();
    const profileResult = await admin.from("player_knowledge_profiles").select("*").eq("player_id", resolved.player.id).maybeSingle();
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (!profileResult.data) return NextResponse.json({ error: "Este Player todavía no configuró Conocimiento." }, { status: 404 });
    const profile = profileResult.data as PlayerKnowledgeProfile;
    const spec = buildPrompt(topic, profile);

    const cached = await admin
      .from("player_knowledge_insights")
      .select("content,sources,model,generated_at,expires_at")
      .eq("player_id", resolved.player.id)
      .eq("topic", topic)
      .eq("subject_key", spec.subjectKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (cached.error) throw new Error(cached.error.message);
    if (cached.data) {
      const row = cached.data as CachedInsight;
      return NextResponse.json({
        topic,
        title: spec.title,
        content: row.content,
        sources: Array.isArray(row.sources) ? row.sources : [],
        model: row.model,
        generatedAt: row.generated_at,
        cached: true,
        grounded: true,
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "CLOUVA AI no tiene configurada la clave de Gemini." }, { status: 503 });
    const result = await generateGroundedWithFallback({
      apiKey,
      selectedModel: selectedModelFromRequest(request),
      instruction: "Sos CLOUVA AI en modo Conocimiento. Priorizá fuentes verificables y separá hechos observables de tradiciones interpretativas. Nunca inventes una fuente ni una observación actual.",
      prompt: spec.prompt,
      maxOutputTokens: 1800,
    });
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + spec.expiresHours * 60 * 60 * 1000);

    const write = await admin.from("player_knowledge_insights").upsert({
      player_id: resolved.player.id,
      topic,
      subject_key: spec.subjectKey,
      content: result.text,
      sources: result.sources,
      model: result.model,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    }, { onConflict: "player_id,topic,subject_key" });
    if (write.error) throw new Error(write.error.message);

    return NextResponse.json({
      topic,
      title: spec.title,
      content: result.text,
      sources: result.sources,
      model: result.model,
      generatedAt: generatedAt.toISOString(),
      cached: false,
      grounded: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar esta data.";
    const status = message.startsWith("Este Player") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
