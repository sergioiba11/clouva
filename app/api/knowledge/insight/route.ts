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

const RICH_FORMAT = `
Formato de salida para CLOUVA:
- Usá Markdown limpio pensado para una interfaz móvil: títulos ##, subtítulos ###, negritas, listas y tablas sólo cuando realmente ayuden.
- No muestres símbolos Markdown como explicación ni encierres toda la respuesta en un bloque de código.
- Empezá por lo más útil; evitá introducciones largas y relleno.
- Incluí al menos un ejemplo concreto o una comparación simple cuando ayude a entender.
- Si dos fuentes difieren, decilo y explicá brevemente la diferencia.
- No pegues URLs dentro del cuerpo: CLOUVA muestra las fuentes aparte.
- Podés sugerir qué convendría representar visualmente, pero no describas una imagen como si fuera evidencia real.
`;

function buildPrompt(topic: Topic, profile: PlayerKnowledgeProfile) {
  const day = utcDay();
  if (topic === "lunar") {
    if (!profile.show_lunar) throw new Error("Este Player no publica conocimiento lunar.");
    return {
      title: "Data de la Luna",
      subjectKey: `lunar:${day}:rich-v2`,
      expiresHours: 8,
      prompt: `Fecha de referencia: ${day}. Buscá en la web información astronómica actual y verificable sobre la Luna para esta fecha.

Explicá, cuando las fuentes lo permitan:
- fase lunar actual;
- iluminación aproximada;
- edad lunar o posición dentro del ciclo si está disponible;
- próximos hitos relevantes (cuarto, luna nueva o luna llena);
- eventos observables destacados sólo si una fuente confiable los confirma.

Separá con claridad una sección de "Datos astronómicos verificables" de cualquier "Lectura cultural, espiritual o astrológica". No mezcles constelación astronómica con signo astrológico. Si una lectura interpretativa no tiene consenso científico, marcala como tradición o interpretación.

Dá un ejemplo simple que ayude a una persona a entender qué significa la fase actual dentro del ciclo lunar. Respondé en español rioplatense claro y natural.${RICH_FORMAT}`,
    };
  }

  if (topic === "numerologia") {
    const number = calculateNumerologyNumber(profile.birth_date);
    if (!profile.show_numerology || number === null) throw new Error("Este Player no publica numerología.");
    return {
      title: `Número ${number}`,
      subjectKey: `numerologia:${number}:rich-v2`,
      expiresHours: 24 * 30,
      prompt: `El número calculado por suma de los dígitos de la fecha de nacimiento y reducción a un dígito es ${number}. Buscá fuentes web y explicá qué representa el número ${number} dentro de tradiciones numerológicas documentadas.

Mostrá claramente:
- cómo se interpreta tradicionalmente el ${number};
- fortalezas asociadas;
- desafíos o sombras asociadas;
- un ejemplo cotidiano de cómo una persona que se identifica con esa lectura podría reconocer esos rasgos;
- una nota breve sobre el origen/tradición cuando haya fuentes suficientes.

Diferenciá con claridad historia o práctica documentada de interpretación simbólica. No presentes numerología como hecho científico. Respondé en español rioplatense, útil y pedagógico.${RICH_FORMAT}`,
    };
  }

  const sign = zodiacSignFromBirthDate(profile.birth_date);
  if (!profile.show_zodiac || !sign) throw new Error("Este Player no publica astrología.");
  return {
    title: sign,
    subjectKey: `astrologia:${sign.toLocaleLowerCase("es")}:${day}:rich-v2`,
    expiresHours: 18,
    prompt: `El signo zodiacal tropical calculado por fecha de nacimiento es ${sign}. Fecha actual de referencia: ${day}. Buscá fuentes web actuales y prepará una ficha educativa sobre ${sign}.

Separá explícitamente:
1. "Astronomía": datos verificables de la constelación/cielo cuando sean relevantes.
2. "Astrología": asociaciones tradicionales del signo ${sign}, indicando que son interpretativas y no hechos científicos.

Incluí rasgos tradicionalmente asociados, fortalezas, desafíos y un ejemplo concreto. Si hablás del cielo actual, usá fuentes recientes y no atribuyas automáticamente la posición astronómica de la Luna a un signo astrológico sin explicar el sistema usado. Respondé en español rioplatense claro y natural.${RICH_FORMAT}`,
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
      instruction: "Sos CLOUVA AI en modo Conocimiento. Tu tarea es enseñar, no llenar espacio. Buscá en la web cuando corresponda, priorizá fuentes verificables, explicá con ejemplos y separá hechos observables de tradiciones interpretativas. Nunca inventes una fuente, una observación actual ni una imagen real.",
      prompt: spec.prompt,
      maxOutputTokens: 2400,
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
