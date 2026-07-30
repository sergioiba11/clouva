import "server-only";
import type { IdentityBrief } from "@/lib/server/vip-profile-brief";

// gemini-3.1-flash-lite text pricing (per ai.google.dev/gemini-api/docs/pricing,
// same effectiveFrom date as the image pricing table in lib/ai-budget/gemini-pricing.ts).
// Not gated against the shared USD 40 image budget -- that ledger exists
// specifically for image generation; a copy/analysis call costs a fraction of
// a cent and is tracked on the job row for transparency only.
const TEXT_MODEL = "gemini-3.1-flash-lite";
const INPUT_PRICE_PER_MILLION = 0.1;
const OUTPUT_PRICE_PER_MILLION = 0.4;

export type ProfileCopy = {
  tagline: string | null;
  short_bio: string | null;
  seo_title: string | null;
  seo_description: string | null;
  share_title: string | null;
  share_description: string | null;
  visual_energy: string | null;
  visual_tone: string | null;
};

export class VipProfileGeminiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function buildPrompt(brief: IdentityBrief): string {
  // Only public.players columns for this exact Player go into `facts` --
  // never anything Gemini itself said in a previous call. This is what
  // enforces "no inventar" structurally, not just via prompt wording.
  const facts = {
    display_name: brief.display_name,
    username: brief.username,
    professional_categories: brief.professional_categories,
    primary_role: brief.primary_role,
    existing_short_bio: brief.short_bio,
    origin: brief.origin,
    location: brief.location,
    genres: brief.genres,
    disciplines: brief.disciplines,
    studios: brief.studios.map((s) => ({ name: s.name, role: s.role })),
    has_spotify: Boolean(brief.spotify_url),
    has_youtube: Boolean(brief.youtube_url),
    has_gallery: brief.selected_gallery.length > 0,
  };

  return [
    "Sos el redactor de CLOUVA, una plataforma para artistas, creadores y productores.",
    "Tu tarea: proponer copy para la carta de presentación profesional de un Player, EXCLUSIVAMENTE a partir de los hechos confirmados abajo.",
    "",
    "REGLA ABSOLUTA: no inventes ni asumas premios, colaboraciones, canciones, discos, estudios, ciudades, géneros, sellos, fechas, estadísticas, cantidad de seguidores, experiencia ni ningún dato personal que no esté en 'facts'. Si un campo no tiene información suficiente para escribirlo con honestidad, devolvé null en ese campo -- nunca lo completes inventando.",
    "Tono: directo, seguro, urbano, frases cortas. Nada de clichés genéricos de marketing.",
    "",
    `facts (único material permitido): ${JSON.stringify(facts)}`,
    "",
    "Devolvé SOLO un JSON con esta forma exacta, sin texto alrededor:",
    "{",
    '  "tagline": string | null,           // frase corta de identidad, 2 líneas máximo, basada solo en facts',
    '  "short_bio": string | null,         // versión pulida de existing_short_bio (o null si existing_short_bio es null)',
    '  "seo_title": string | null,',
    '  "seo_description": string | null,   // máximo 160 caracteres',
    '  "share_title": string | null,',
    '  "share_description": string | null,',
    '  "visual_energy": string | null,     // 2-4 palabras describiendo la energía visual sugerida por facts (ej. "explosivo, urbano")',
    '  "visual_tone": string | null        // 2-4 palabras de paleta/tono sugerido (ej. "oscuro, violeta, contraste alto")',
    "}",
  ].join("\n");
}

export async function generateProfileCopy(brief: IdentityBrief): Promise<{ copy: ProfileCopy; costUsd: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new VipProfileGeminiError("GEMINI_API_KEY no está configurada.", 500);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(brief) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30 * 1000),
    },
  );

  const raw = await response.text();
  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    error?: { message?: string };
  } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new VipProfileGeminiError("Gemini devolvió una respuesta inválida.");
  }
  if (!response.ok) {
    throw new VipProfileGeminiError(data.error?.message ?? `Gemini respondió HTTP ${response.status}`, response.status);
  }

  const text = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  if (!text) throw new VipProfileGeminiError("Gemini no devolvió texto.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VipProfileGeminiError("No se pudo interpretar la respuesta de Gemini como JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new VipProfileGeminiError("Respuesta de Gemini con forma inesperada.");

  const raw2 = parsed as Record<string, unknown>;
  const asStringOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const copy: ProfileCopy = {
    tagline: asStringOrNull(raw2.tagline),
    short_bio: asStringOrNull(raw2.short_bio),
    seo_title: asStringOrNull(raw2.seo_title),
    seo_description: asStringOrNull(raw2.seo_description),
    share_title: asStringOrNull(raw2.share_title),
    share_description: asStringOrNull(raw2.share_description),
    visual_energy: asStringOrNull(raw2.visual_energy),
    visual_tone: asStringOrNull(raw2.visual_tone),
  };

  const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd = Number(
    ((promptTokens / 1_000_000) * INPUT_PRICE_PER_MILLION + (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION).toFixed(6),
  );

  return { copy, costUsd };
}
