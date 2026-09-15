import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroundedSource } from "@/lib/clouva-ai/gemini-grounded";
import {
  calculateNumerologyNumber,
  zodiacSignFromBirthDate,
  type PlayerKnowledgeProfile,
} from "@/lib/knowledge/player-knowledge";

export type KnowledgeTopic = "lunar" | "numerologia" | "astrologia";
export type KnowledgeInsightState = "fresh" | "stale" | "empty";

export type KnowledgeInsightView = {
  topic: KnowledgeTopic;
  title: string;
  content: string | null;
  sources: GroundedSource[];
  model: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  cached: boolean;
  stale: boolean;
  refreshing: boolean;
  grounded: boolean;
  state: KnowledgeInsightState;
};

export type KnowledgeSpec = {
  title: string;
  subjectKey: string;
  expiresHours: number;
  prompt: string;
};

type CachedInsightRow = {
  player_id: string;
  topic: string;
  subject_key: string;
  content: string;
  sources: GroundedSource[] | null;
  model: string | null;
  generated_at: string;
  expires_at: string;
  refresh_started_at: string | null;
  refresh_token: string | null;
};

const CACHE_COLUMNS =
  "player_id,topic,subject_key,content,sources,model,generated_at,expires_at,refresh_started_at,refresh_token";
const REFRESH_LOCK_MS = 45_000;
const EMPTY_TIME = "1970-01-01T00:00:00.000Z";

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

function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function knowledgeTopicFrom(value: string | null | undefined): KnowledgeTopic | null {
  return value === "lunar" || value === "numerologia" || value === "astrologia" ? value : null;
}

export function buildKnowledgeSpec(
  topic: KnowledgeTopic,
  profile: PlayerKnowledgeProfile,
  now = new Date(),
): KnowledgeSpec {
  const day = utcDay(now);

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

function isRefreshActive(value: string | null | undefined, now = Date.now()) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now - timestamp < REFRESH_LOCK_MS;
}

function asSources(value: unknown): GroundedSource[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is GroundedSource =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as GroundedSource).title === "string" &&
              typeof (item as GroundedSource).url === "string",
          ),
      )
    : [];
}

function viewFromRow(
  topic: KnowledgeTopic,
  spec: KnowledgeSpec,
  row: CachedInsightRow | null,
  refreshing: boolean,
  now = Date.now(),
): KnowledgeInsightView {
  const hasContent = Boolean(row?.content?.trim());
  if (!row || !hasContent) {
    return {
      topic,
      title: spec.title,
      content: null,
      sources: [],
      model: null,
      generatedAt: null,
      expiresAt: null,
      cached: false,
      stale: true,
      refreshing,
      grounded: false,
      state: "empty",
    };
  }

  const expiry = Date.parse(row.expires_at);
  const subjectChanged = row.subject_key !== spec.subjectKey;
  const stale = subjectChanged || !Number.isFinite(expiry) || expiry <= now;

  return {
    topic,
    title: spec.title,
    content: row.content,
    sources: asSources(row.sources),
    model: row.model,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
    cached: true,
    stale,
    refreshing,
    grounded: true,
    state: stale ? "stale" : "fresh",
  };
}

async function queryCurrentRow(
  admin: SupabaseClient,
  playerId: string,
  topic: KnowledgeTopic,
  spec: KnowledgeSpec,
) {
  if (topic === "lunar") {
    const result = await admin
      .from("player_knowledge_insights")
      .select(CACHE_COLUMNS)
      .eq("topic", topic)
      .eq("subject_key", spec.subjectKey)
      .neq("content", "")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return (result.data as CachedInsightRow | null) ?? null;
  }

  const result = await admin
    .from("player_knowledge_insights")
    .select(CACHE_COLUMNS)
    .eq("player_id", playerId)
    .eq("topic", topic)
    .eq("subject_key", spec.subjectKey)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CachedInsightRow | null) ?? null;
}

async function queryLatestLunarFallback(admin: SupabaseClient) {
  const result = await admin
    .from("player_knowledge_insights")
    .select(CACHE_COLUMNS)
    .eq("topic", "lunar")
    .neq("content", "")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CachedInsightRow | null) ?? null;
}

async function hasActiveRefresh(
  admin: SupabaseClient,
  playerId: string,
  topic: KnowledgeTopic,
  spec: KnowledgeSpec,
) {
  const threshold = new Date(Date.now() - REFRESH_LOCK_MS).toISOString();
  let query = admin
    .from("player_knowledge_insights")
    .select("player_id,refresh_started_at")
    .eq("topic", topic)
    .eq("subject_key", spec.subjectKey)
    .gte("refresh_started_at", threshold)
    .order("refresh_started_at", { ascending: false })
    .limit(1);

  if (topic !== "lunar") query = query.eq("player_id", playerId);

  const result = await query.maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data);
}

async function ownsGlobalLunarLock(
  admin: SupabaseClient,
  spec: KnowledgeSpec,
  token: string,
) {
  const threshold = new Date(Date.now() - REFRESH_LOCK_MS).toISOString();
  const result = await admin
    .from("player_knowledge_insights")
    .select("refresh_token")
    .eq("topic", "lunar")
    .eq("subject_key", spec.subjectKey)
    .gte("refresh_started_at", threshold)
    .order("refresh_started_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data?.refresh_token === token;
}

export async function readKnowledgeInsight(
  admin: SupabaseClient,
  playerId: string,
  topic: KnowledgeTopic,
  spec: KnowledgeSpec,
): Promise<KnowledgeInsightView> {
  const current = await queryCurrentRow(admin, playerId, topic, spec);
  let candidate = current;

  // La data lunar es global. Si hoy todavía no se generó, reutilizamos la
  // última síntesis disponible mientras se revalida la fecha actual.
  if (!candidate?.content?.trim() && topic === "lunar") {
    candidate = await queryLatestLunarFallback(admin);
  }

  const staleByRow = candidate
    ? candidate.subject_key !== spec.subjectKey || Date.parse(candidate.expires_at) <= Date.now()
    : true;
  const refreshing =
    isRefreshActive(current?.refresh_started_at) ||
    (staleByRow ? await hasActiveRefresh(admin, playerId, topic, spec) : false);

  return viewFromRow(topic, spec, candidate, refreshing);
}

async function ownCurrentRow(
  admin: SupabaseClient,
  playerId: string,
  topic: KnowledgeTopic,
  spec: KnowledgeSpec,
) {
  const result = await admin
    .from("player_knowledge_insights")
    .select(CACHE_COLUMNS)
    .eq("player_id", playerId)
    .eq("topic", topic)
    .eq("subject_key", spec.subjectKey)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CachedInsightRow | null) ?? null;
}

async function tryUpdateLock(
  admin: SupabaseClient,
  playerId: string,
  topic: KnowledgeTopic,
  subjectKey: string,
  token: string,
  startedAt: string,
  mode: "empty" | "expired",
) {
  let query = admin
    .from("player_knowledge_insights")
    .update({ refresh_started_at: startedAt, refresh_token: token })
    .eq("player_id", playerId)
    .eq("topic", topic)
    .eq("subject_key", subjectKey);

  query =
    mode === "empty"
      ? query.is("refresh_started_at", null)
      : query.lt("refresh_started_at", new Date(Date.now() - REFRESH_LOCK_MS).toISOString());

  const result = await query.select("player_id").maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data);
}

export async function acquireKnowledgeRefreshLock(
  admin: SupabaseClient,
  playerId: string,
  topic: KnowledgeTopic,
  spec: KnowledgeSpec,
) {
  if (topic === "lunar" && (await hasActiveRefresh(admin, playerId, topic, spec))) {
    return { acquired: false as const, token: null };
  }

  const token = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const existing = await ownCurrentRow(admin, playerId, topic, spec);

  if (!existing) {
    const inserted = await admin
      .from("player_knowledge_insights")
      .insert({
        player_id: playerId,
        topic,
        subject_key: spec.subjectKey,
        content: "",
        sources: [],
        model: null,
        generated_at: EMPTY_TIME,
        expires_at: EMPTY_TIME,
        refresh_started_at: startedAt,
        refresh_token: token,
      })
      .select("player_id")
      .maybeSingle();

    if (!inserted.error && inserted.data) {
      if (topic === "lunar" && !(await ownsGlobalLunarLock(admin, spec, token))) {
        await releaseKnowledgeRefreshLock(admin, playerId, topic, spec.subjectKey, token);
        return { acquired: false as const, token: null };
      }
      return { acquired: true as const, token };
    }
    if (inserted.error?.code !== "23505") throw new Error(inserted.error?.message || "No se pudo reservar la actualización.");
  }

  if (await tryUpdateLock(admin, playerId, topic, spec.subjectKey, token, startedAt, "empty")) {
    if (topic === "lunar" && !(await ownsGlobalLunarLock(admin, spec, token))) {
      await releaseKnowledgeRefreshLock(admin, playerId, topic, spec.subjectKey, token);
      return { acquired: false as const, token: null };
    }
    return { acquired: true as const, token };
  }
  if (await tryUpdateLock(admin, playerId, topic, spec.subjectKey, token, startedAt, "expired")) {
    if (topic === "lunar" && !(await ownsGlobalLunarLock(admin, spec, token))) {
      await releaseKnowledgeRefreshLock(admin, playerId, topic, spec.subjectKey, token);
      return { acquired: false as const, token: null };
    }
    return { acquired: true as const, token };
  }

  return { acquired: false as const, token: null };
}

export async function releaseKnowledgeRefreshLock(
  admin: SupabaseClient,
  playerId: string,
  topic: KnowledgeTopic,
  subjectKey: string,
  token: string,
) {
  const result = await admin
    .from("player_knowledge_insights")
    .update({ refresh_started_at: null, refresh_token: null })
    .eq("player_id", playerId)
    .eq("topic", topic)
    .eq("subject_key", subjectKey)
    .eq("refresh_token", token);
  if (result.error) throw new Error(result.error.message);
}

export async function writeKnowledgeInsight(args: {
  admin: SupabaseClient;
  playerId: string;
  topic: KnowledgeTopic;
  spec: KnowledgeSpec;
  content: string;
  sources: GroundedSource[];
  model: string | null;
  generatedAt: Date;
}) {
  const expiresAt = new Date(args.generatedAt.getTime() + args.spec.expiresHours * 60 * 60 * 1000);
  const result = await args.admin.from("player_knowledge_insights").upsert(
    {
      player_id: args.playerId,
      topic: args.topic,
      subject_key: args.spec.subjectKey,
      content: args.content,
      sources: args.sources,
      model: args.model,
      generated_at: args.generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      refresh_started_at: null,
      refresh_token: null,
    },
    { onConflict: "player_id,topic,subject_key" },
  );
  if (result.error) throw new Error(result.error.message);

  return {
    topic: args.topic,
    title: args.spec.title,
    content: args.content,
    sources: args.sources,
    model: args.model,
    generatedAt: args.generatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    cached: false,
    stale: false,
    refreshing: false,
    grounded: true,
    state: "fresh" as const,
  } satisfies KnowledgeInsightView;
}
