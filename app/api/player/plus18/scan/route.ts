import { Storage } from "@google-cloud/storage";
import { NextRequest, NextResponse } from "next/server";
import { generateImage, GeminiImageError } from "@/lib/gemini-image";
import { AdultAccessError, requireAdultUser } from "@/lib/player-plus18/server";
import { isAuthError } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_MEDIA_BUCKET = "clouva-generated-media";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const storage = new Storage();

type CandidateStrain = {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  strain_type: string | null;
  profile: string | null;
  tags: string[] | null;
  aromas: string[] | null;
};

type MatchResult = {
  slug: string;
  name: string;
  similarity: number;
  reasons: string[];
};

type VisionAnalysis = {
  summary?: string;
  features?: Array<{ label?: string; value?: string }>;
  targetComparison?: MatchResult | null;
  matches?: MatchResult[];
};

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  error?: { message?: string };
};

function extensionForMime(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function mediaBucket() {
  return process.env.CLOUVA_PUBLIC_MEDIA_BUCKET || process.env.CLOUVA_GENERATED_MEDIA_BUCKET || DEFAULT_MEDIA_BUCKET;
}

async function storeImage(args: { userId: string; scanId: string; label: "original" | "enhanced"; bytes: Buffer; mimeType: string }) {
  const bucketName = mediaBucket();
  const objectPath = `player-plus18/${args.userId}/scans/${args.scanId}/${args.label}.${extensionForMime(args.mimeType)}`;
  await storage.bucket(bucketName).file(objectPath).save(args.bytes, {
    contentType: args.mimeType,
    resumable: false,
    metadata: { cacheControl: "private, max-age=0, no-store" },
  });
  return {
    path: objectPath,
    url: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
  };
}

function extractJson(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as VisionAnalysis;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as VisionAnalysis;
    throw new Error("Gemini no devolvió un análisis JSON utilizable.");
  }
}

function sanitizeAnalysis(raw: VisionAnalysis, candidates: CandidateStrain[], targetSlug: string | null) {
  const bySlug = new Map(candidates.map((item) => [item.slug, item]));
  const normalizeMatch = (match: MatchResult | null | undefined): MatchResult | null => {
    if (!match || typeof match.slug !== "string") return null;
    const candidate = bySlug.get(match.slug);
    if (!candidate) return null;
    const numeric = Number(match.similarity);
    return {
      slug: candidate.slug,
      name: candidate.name,
      similarity: Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0,
      reasons: Array.isArray(match.reasons)
        ? match.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0).slice(0, 5)
        : [],
    };
  };

  const matches = (Array.isArray(raw.matches) ? raw.matches : [])
    .map(normalizeMatch)
    .filter((item): item is MatchResult => Boolean(item))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  let targetComparison = normalizeMatch(raw.targetComparison);
  if (!targetComparison && targetSlug) targetComparison = matches.find((item) => item.slug === targetSlug) ?? null;

  const features = Array.isArray(raw.features)
    ? raw.features
        .map((item) => ({
          label: typeof item?.label === "string" ? item.label.trim() : "",
          value: typeof item?.value === "string" ? item.value.trim() : "",
        }))
        .filter((item) => item.label && item.value)
        .slice(0, 8)
    : [];

  return {
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 1200) : "",
    features,
    targetComparison,
    matches,
  };
}

async function callVisionModel(args: {
  apiKey: string;
  originalBase64: string;
  originalMimeType: string;
  enhancedBase64?: string;
  enhancedMimeType?: string;
  candidates: Array<CandidateStrain & { terpenes: string[]; flavors: string[] }>;
  targetSlug: string | null;
  useWeb: boolean;
}) {
  const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const target = args.targetSlug ? args.candidates.find((item) => item.slug === args.targetSlug) ?? null : null;
  const catalog = args.candidates.map((item) => ({
    slug: item.slug,
    name: item.name,
    type: item.strain_type,
    profile: item.profile,
    tags: item.tags,
    aromas: item.aromas,
    terpenes: item.terpenes,
    flavors: item.flavors,
  }));

  const prompt = `Actuás como analizador visual de flores de cannabis para CLOUVA Player +18.\n\nTu tarea NO es identificar una genética con certeza. Una foto no permite confirmar genética. Debés describir rasgos visibles y ordenar SOLAMENTE las genéticas del catálogo interno por similitud visual orientativa.\n\nRecibís primero la FOTO ORIGINAL y, si existe, después una MEJORA IA de la misma foto. Para forma, color y rasgos reales, la original manda. La mejora sirve únicamente para ver detalle. Si la mejora inventa o altera algo, ignoralo.\n\nRasgos a observar: estructura, densidad aparente, pistilos, tricomas aparentes, tonos, forma del cogollo y contraste visual. No infieras potencia, THC, calidad, seguridad ni composición química a partir de la imagen.\n\n${target ? `El usuario está comparando específicamente contra ${target.name} (slug ${target.slug}).` : "El usuario quiere saber a cuáles del catálogo se parece más."}\n${args.useWeb ? "Podés usar Google Search únicamente para enriquecer contexto público sobre las genéticas nombradas; no uses la web para convertir la foto en un diagnóstico ni para inventar una coincidencia." : "No uses información externa."}\n\nCATÁLOGO INTERNO:\n${JSON.stringify(catalog)}\n\nRespondé SOLO JSON con esta forma exacta:\n{\n  "summary": "texto breve",\n  "features": [{"label":"Estructura","value":"..."}],\n  "targetComparison": ${target ? `{"slug":"${target.slug}","name":"${target.name}","similarity":0,"reasons":["..."]}` : "null"},\n  "matches": [{"slug":"slug-del-catalogo","name":"Nombre","similarity":0,"reasons":["..."]}]\n}\n\nLa similitud es una estimación visual 0-100, no una probabilidad genética. Devolvé máximo 5 matches y nunca inventes un slug fuera del catálogo.`;

  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    { inlineData: { mimeType: args.originalMimeType, data: args.originalBase64 } },
  ];
  if (args.enhancedBase64 && args.enhancedMimeType) {
    parts.push({ inlineData: { mimeType: args.enhancedMimeType, data: args.enhancedBase64 } });
  }

  async function run(withWeb: boolean) {
    const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        ...(withWeb ? { tools: [{ googleSearch: {} }] } : {}),
        generationConfig: { temperature: 0.15, maxOutputTokens: 4096 },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await response.json().catch(() => ({}))) as GeminiPayload;
    if (!response.ok) throw new Error(data.error?.message || `Gemini respondió HTTP ${response.status}`);
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini respondió sin análisis utilizable.");
    const references = data.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk) => chunk.web)
      .filter((web): web is { uri: string; title?: string } => Boolean(web?.uri))
      .map((web) => ({ url: web.uri, title: web.title || web.uri }))
      .slice(0, 8) ?? [];
    return { raw: extractJson(text), references, webGrounded: withWeb && references.length > 0 };
  }

  if (args.useWeb) {
    try {
      return await run(true);
    } catch (error) {
      console.warn("PLAYER_PLUS18_WEB_GROUNDING_FALLBACK", error);
    }
  }
  return run(false);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo analizar la imagen.";
  const status = error instanceof AdultAccessError
    ? error.status
    : error instanceof GeminiImageError
      ? error.status
      : isAuthError(error)
        ? 401
        : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAdultUser(request);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 500 });

    const form = await request.formData();
    const image = form.get("image");
    const targetSlugRaw = form.get("targetSlug");
    const useWebRaw = form.get("useWeb");
    const targetSlug = typeof targetSlugRaw === "string" && targetSlugRaw.trim() ? targetSlugRaw.trim() : null;
    const useWeb = useWebRaw === "true";

    if (!(image instanceof File)) return NextResponse.json({ error: "Subí una imagen del coco." }, { status: 400 });
    if (!ALLOWED_IMAGE_TYPES.has(image.type)) return NextResponse.json({ error: "Usá una imagen JPG, PNG o WEBP." }, { status: 415 });
    if (!image.size || image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "La imagen supera el límite de 12 MB." }, { status: 413 });

    const originalBytes = Buffer.from(await image.arrayBuffer());
    const originalBase64 = originalBytes.toString("base64");
    const scanId = crypto.randomUUID();

    const { data: strainsData, error: strainsError } = await access.supabase
      .from("cannabis_strains")
      .select("id,slug,name,subtitle,strain_type,profile,tags,aromas")
      .eq("is_published", true)
      .order("is_featured", { ascending: false })
      .limit(80);
    if (strainsError) throw strainsError;

    const candidates = (strainsData ?? []) as CandidateStrain[];
    if (!candidates.length) return NextResponse.json({ error: "No hay genéticas publicadas para comparar." }, { status: 409 });
    if (targetSlug && !candidates.some((item) => item.slug === targetSlug)) {
      return NextResponse.json({ error: "La genética objetivo no está publicada." }, { status: 404 });
    }

    const ids = candidates.map((item) => item.id);
    const [terpenesResult, flavorsResult] = await Promise.all([
      access.supabase.from("strain_terpenes").select("strain_id,terpene").in("strain_id", ids),
      access.supabase.from("strain_flavors").select("strain_id,flavor").in("strain_id", ids),
    ]);
    if (terpenesResult.error) throw terpenesResult.error;
    if (flavorsResult.error) throw flavorsResult.error;

    const catalog = candidates.map((item) => ({
      ...item,
      terpenes: (terpenesResult.data ?? []).filter((row) => row.strain_id === item.id).map((row) => String(row.terpene)),
      flavors: (flavorsResult.data ?? []).filter((row) => row.strain_id === item.id).map((row) => String(row.flavor)),
    }));

    const originalStored = await storeImage({
      userId: access.user.id,
      scanId,
      label: "original",
      bytes: originalBytes,
      mimeType: image.type,
    });

    let enhancedBytes: Buffer | null = null;
    let enhancedMimeType: string | null = null;
    let enhancementError: string | null = null;
    try {
      const enhanced = await generateImage({
        apiKey,
        referenceImages: [{ mimeType: image.type, data: originalBase64 }],
        aspectRatio: "1:1",
        imageSize: "1K",
        timeoutMs: 50_000,
        prompt: "Enhance this exact cannabis flower photograph for visual inspection. Preserve the same single flower, silhouette, structure, leaf placement, visible color relationships, pistil positions and apparent trichome distribution. Improve focus, micro-contrast, exposure and local detail; reduce distracting background while keeping a natural photographic result. Do not add or remove buds, do not invent extra resin, do not make it look like a specific named strain, do not add pineapple imagery, labels or decorative styling. This is a faithful technical enhancement of the provided photo, not a creative transformation.",
      });
      enhancedBytes = enhanced.bytes;
      enhancedMimeType = enhanced.mimeType;
    } catch (error) {
      enhancementError = error instanceof Error ? error.message : "No se pudo generar la mejora visual.";
      console.warn("PLAYER_PLUS18_IMAGE_ENHANCEMENT_FAILED", enhancementError);
    }

    let enhancedStored: { path: string; url: string } | null = null;
    if (enhancedBytes && enhancedMimeType) {
      enhancedStored = await storeImage({
        userId: access.user.id,
        scanId,
        label: "enhanced",
        bytes: enhancedBytes,
        mimeType: enhancedMimeType,
      });
    }

    const vision = await callVisionModel({
      apiKey,
      originalBase64,
      originalMimeType: image.type,
      enhancedBase64: enhancedBytes?.toString("base64"),
      enhancedMimeType: enhancedMimeType ?? undefined,
      candidates: catalog,
      targetSlug,
      useWeb,
    });
    const analysis = sanitizeAnalysis(vision.raw, candidates, targetSlug);

    const storedAnalysis = {
      version: 1,
      mode: targetSlug ? "target_and_catalog" : "catalog",
      target_slug: targetSlug,
      original_url: originalStored.url,
      enhanced_url: enhancedStored?.url ?? null,
      enhancement_error: enhancementError,
      web_grounded: vision.webGrounded,
      references: vision.references,
      ...analysis,
    };

    const { error: saveError } = await access.supabase.from("strain_scans").insert({
      id: scanId,
      user_id: access.user.id,
      image_url: enhancedStored?.url ?? originalStored.url,
      analysis: storedAnalysis,
    });
    if (saveError) throw saveError;

    return NextResponse.json({
      scanId,
      originalUrl: originalStored.url,
      enhancedUrl: enhancedStored?.url ?? null,
      enhancementError,
      webGrounded: vision.webGrounded,
      references: vision.references,
      ...analysis,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
