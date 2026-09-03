import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini-image";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { calculateNumerologyNumber, zodiacSignFromBirthDate, type PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Topic = "lunar" | "numerologia" | "astrologia";

type VisualBody = {
  alias?: string;
  topic?: Topic;
  heading?: string;
  value?: string | null;
  context?: string;
};

function topicFrom(value: unknown): Topic | null {
  return value === "lunar" || value === "numerologia" || value === "astrologia" ? value : null;
}

async function canEditPlayer(admin: ReturnType<typeof createAdminSupabase>, playerId: string, ownerUserId: string | null, userId: string) {
  if (ownerUserId === userId) return true;
  const membership = await admin
    .from("player_members")
    .select("player_id")
    .eq("player_id", playerId)
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .maybeSingle();
  if (membership.error) throw new Error(membership.error.message);
  return Boolean(membership.data);
}

function visualPrompt(topic: Topic, heading: string, value: string | null, context: string) {
  const subject = value ? `${heading}: ${value}` : heading;
  const common = `
Creá una lámina educativa premium para CLOUVA sobre "${subject}".
Formato horizontal 16:9, estética oscura elegante y espacial, alto contraste, visual limpio, moderno y legible en teléfono.
El objetivo es ENSEÑAR visualmente: usá diagrama, comparación, secuencia, iconografía o una composición explicativa cuando aporte valor.
No inventes fotografías, observaciones ni datos científicos. Si el tema incluye astrología o numerología, presentá lo simbólico como interpretación/tradición y no como evidencia científica.
Texto dentro de la imagen: muy poco, sólo etiquetas cortas en español y únicamente si son legibles. No agregues URLs, marcas de agua ni citas falsas.
Contexto de la explicación de CLOUVA AI:
${context.slice(0, 3_500)}
`;

  if (topic === "lunar") {
    return `${common}\nPriorizá un visual del ciclo/fase lunar que ayude a entender la fase actual. Diferenciá cualquier lectura simbólica de los datos astronómicos.`;
  }
  if (topic === "numerologia") {
    return `${common}\nPriorizá una infografía conceptual del número y sus asociaciones tradicionales: fortalezas, desafíos y un ejemplo cotidiano. No la presentes como ciencia.`;
  }
  return `${common}\nPriorizá una ficha visual del signo que separe claramente Astronomía de Astrología y use el símbolo zodiacal sólo como recurso gráfico.`;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({})) as VisualBody;
    const alias = typeof body.alias === "string" ? body.alias.trim() : "";
    const topic = topicFrom(body.topic);
    if (!alias || !topic) return NextResponse.json({ error: "Falta Player o tema." }, { status: 400 });

    const resolved = await resolvePlayerAlias(alias).catch(() => null);
    if (!resolved) return NextResponse.json({ error: "Player no disponible." }, { status: 404 });

    const admin = createAdminSupabase();
    if (!await canEditPlayer(admin, resolved.player.id, resolved.player.owner_user_id, user.id)) {
      return NextResponse.json({ error: "Sólo el Player o su equipo puede generar este visual." }, { status: 403 });
    }

    const profileResult = await admin.from("player_knowledge_profiles").select("*").eq("player_id", resolved.player.id).maybeSingle();
    if (profileResult.error) throw new Error(profileResult.error.message);
    const profile = profileResult.data as PlayerKnowledgeProfile | null;
    if (!profile) return NextResponse.json({ error: "Conocimiento todavía no está configurado." }, { status: 404 });

    const number = calculateNumerologyNumber(profile.birth_date);
    const sign = zodiacSignFromBirthDate(profile.birth_date);
    const enabled = topic === "lunar" ? profile.show_lunar
      : topic === "numerologia" ? profile.show_numerology && number !== null
      : profile.show_zodiac && Boolean(sign);
    if (!enabled) return NextResponse.json({ error: "Este conocimiento no está activo." }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Gemini no está configurado." }, { status: 503 });

    const heading = typeof body.heading === "string" && body.heading.trim() ? body.heading.trim().slice(0, 100) : "Conocimiento";
    const value = typeof body.value === "string" && body.value.trim() ? body.value.trim().slice(0, 80) : null;
    const context = typeof body.context === "string" ? body.context.trim() : "";

    const generated = await generateImage({
      apiKey,
      model: "gemini-3.1-flash-image",
      prompt: visualPrompt(topic, heading, value, context),
      aspectRatio: "16:9",
      imageSize: "1K",
      timeoutMs: 75_000,
    });
    const stored = await uploadGeneratedMediaObject({
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      pathPrefix: `knowledge/${resolved.player.id}/${topic}`,
    });

    return NextResponse.json({
      url: stored.url,
      mimeType: generated.mimeType,
      model: "gemini-3.1-flash-image",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el visual.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
