import { NextRequest, NextResponse } from "next/server";
import {
  generateImage,
  GeminiImageError,
  type GeminiAspectRatio,
  type GeminiImageModel,
} from "@/lib/gemini-image";
import { startVideoGeneration, type GeminiVideoModel } from "@/lib/gemini-video";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import {
  estimateVideoCostUsd,
  IMAGE_QUALITY_CONFIG,
  isImageAspectRatio,
  isImageQuality,
  isVideoAspectRatio,
  isVideoDuration,
  isVideoQuality,
  VIDEO_QUALITY_CONFIG,
  type ImageAspectRatio,
  type ImageQuality,
  type MediaSourceMode,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoQuality,
} from "@/lib/media-generation-config";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import {
  downloadReferenceImage,
  MEDIA_JOB_COLUMNS,
  toPublicMediaJob,
  type MediaJobRow,
} from "@/lib/server/media-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const LEGACY_IMAGE_MODELS: GeminiImageModel[] = ["gemini-3.1-flash-image", "gemini-3-pro-image"];
const MAX_PROMPT_LENGTH = 4_000;
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_REQUESTS = 8;
const ACTIVE_JOB_LIMIT = 2;
const MAX_CLOUVA_AI_CONTEXT_CHARS = 2_800;
const REFERENTIAL_IMAGE_PROMPT = /(?:\b(?:esto|eso|aquello|lo anterior|lo de antes|como dijimos|como hablamos|que te ped[ií]|que te dije)\b|\b(?:el|la|ese|esa|este|esta)\s+(?:plano|imagen|foto|portada|render|ilustraci[oó]n|visual|diagrama|esquema|mockup|wireframe|storyboard|l[aá]mina)\b|\b(?:hacelo|hacela|armalo|armala|generalo|generala|crealo|creala)\b)/i;

type MediaGenerateBody = {
  type?: "image" | "video";
  sourceMode?: MediaSourceMode;
  prompt?: string;
  quality?: ImageQuality | VideoQuality;
  aspectRatio?: string;
  durationSeconds?: number;
  referenceUrl?: string | null;
  referenceStoragePath?: string | null;
  idempotencyKey?: string;
  confirmedCostUsd?: number;
  referenceImageUrls?: string[];
  model?: string;
  pathPrefix?: string;
};

type ClouvaAIContextMessage = {
  conversation_id: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

function validatePrompt(raw: unknown) {
  const prompt = typeof raw === "string" ? raw.trim() : "";
  if (!prompt) throw new MediaApiError("Describí lo que querés crear.", 400, "prompt_required");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new MediaApiError("El prompt supera los 4.000 caracteres.", 413, "prompt_too_long");
  return prompt;
}

function isClouvaAIImageMessage(row: ClouvaAIContextMessage, prompt: string) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return row.content.trim() === prompt
    && metadata.provider === "clouva-media"
    && metadata.mode === "chat"
    && metadata.action === "generate_image";
}

async function resolveClouvaAIImagePrompt(
  admin: Awaited<ReturnType<typeof requireMediaAdmin>>["admin"],
  userId: string,
  prompt: string,
) {
  if (prompt.length > 240 || !REFERENTIAL_IMAGE_PROMPT.test(prompt)) return prompt;

  const { data: recentRows, error: recentError } = await admin
    .from("ai_messages")
    .select("conversation_id,role,content,metadata,created_at")
    .eq("user_id", userId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(20);
  if (recentError || !recentRows?.length) return prompt;

  const currentMessage = (recentRows as unknown as ClouvaAIContextMessage[])
    .find((row) => isClouvaAIImageMessage(row, prompt));
  if (!currentMessage?.conversation_id) return prompt;

  const { data: historyRows, error: historyError } = await admin
    .from("ai_messages")
    .select("conversation_id,role,content,metadata,created_at")
    .eq("conversation_id", currentMessage.conversation_id)
    .lt("created_at", currentMessage.created_at)
    .order("created_at", { ascending: false })
    .limit(8);
  if (historyError || !historyRows?.length) return prompt;

  const context = (historyRows as unknown as ClouvaAIContextMessage[])
    .reverse()
    .map((row) => {
      const label = row.role === "assistant" ? "Trébol" : "Usuario";
      const content = row.content.replace(/\s+/g, " ").trim().slice(0, 700);
      return content ? `${label}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
  if (!context) return prompt;

  const boundedContext = context.length > MAX_CLOUVA_AI_CONTEXT_CHARS
    ? context.slice(context.length - MAX_CLOUVA_AI_CONTEXT_CHARS)
    : context;
  return [
    "Usá el contexto previo únicamente para resolver a qué se refiere el pedido visual actual. Conservá el concepto ya definido; no lo reemplaces por uno nuevo.",
    boundedContext,
    `Pedido visual actual: ${prompt}`,
    "Generá la imagen solicitada materializando el concepto previo al que hace referencia el pedido actual.",
  ].join("\n\n").slice(0, MAX_PROMPT_LENGTH);
}

async function enforceRateLimit(admin: Awaited<ReturnType<typeof requireMediaAdmin>>["admin"], userId: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const [recent, active] = await Promise.all([
    admin.from("media_generation_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since),
    admin.from("media_generation_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["queued", "generating", "processing", "saving"]),
  ]);
  if (recent.error || active.error) throw new MediaApiError("No se pudo comprobar el límite de generación.", 500, "rate_limit_check_failed");
  if ((recent.count ?? 0) >= RATE_LIMIT_REQUESTS) {
    throw new MediaApiError("Alcanzaste el límite de generaciones de esta ventana.", 429, "rate_limited");
  }
  if ((active.count ?? 0) >= ACTIVE_JOB_LIMIT) {
    throw new MediaApiError("Ya hay dos generaciones en curso. Esperá a que termine una.", 409, "active_limit");
  }
}

async function legacyImageGeneration(request: NextRequest, body: MediaGenerateBody) {
  await requireMediaAdmin(request);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MediaApiError("GEMINI_API_KEY no está configurada.", 500, "missing_api_key");
  const prompt = validatePrompt(body.prompt);
  const model = LEGACY_IMAGE_MODELS.includes(body.model as GeminiImageModel)
    ? body.model as GeminiImageModel : "gemini-3.1-flash-image";
  const aspectRatio = ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9"].includes(body.aspectRatio ?? "")
    ? body.aspectRatio as GeminiAspectRatio : "1:1";
  const urls = Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls.slice(0, 10) : [];
  const references = await Promise.all(urls.map(downloadReferenceImage));
  const generated = await generateImage({
    apiKey,
    prompt,
    model,
    aspectRatio,
    referenceImages: references.map((reference) => ({ mimeType: reference.mimeType, data: reference.bytes.toString("base64") })),
  });
  const pathPrefix = body.pathPrefix?.replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+/, "") || "generated";
  const stored = await uploadGeneratedMediaObject({ bytes: generated.bytes, mimeType: generated.mimeType, pathPrefix });
  return NextResponse.json({ url: stored.url, mimeType: generated.mimeType, text: generated.text, model });
}

async function createJob(args: {
  admin: Awaited<ReturnType<typeof requireMediaAdmin>>["admin"];
  userId: string;
  idempotencyKey: string;
  type: "image" | "video";
  sourceMode: MediaSourceMode;
  prompt: string;
  model: string;
  aspectRatio: string;
  quality: string;
  durationSeconds: number | null;
  referenceStoragePath: string | null;
  referenceUrl: string | null;
  estimatedCostUsd: number | null;
}) {
  const { data: existing, error: existingError } = await args.admin
    .from("media_generation_jobs")
    .select(MEDIA_JOB_COLUMNS)
    .eq("user_id", args.userId)
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (existingError) throw new MediaApiError("No se pudo comprobar la operación.", 500, "idempotency_check_failed");
  if (existing) return { row: existing as unknown as MediaJobRow, reused: true };

  await enforceRateLimit(args.admin, args.userId);
  const { data, error } = await args.admin
    .from("media_generation_jobs")
    .insert({
      user_id: args.userId,
      idempotency_key: args.idempotencyKey,
      type: args.type,
      source_mode: args.sourceMode,
      status: "generating",
      prompt: args.prompt,
      model: args.model,
      aspect_ratio: args.aspectRatio,
      quality: args.quality,
      duration_seconds: args.durationSeconds,
      reference_storage_path: args.referenceStoragePath,
      reference_url: args.referenceUrl,
      estimated_cost_usd: args.estimatedCostUsd,
      started_at: new Date().toISOString(),
    })
    .select(MEDIA_JOB_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      const { data: raced } = await args.admin
        .from("media_generation_jobs")
        .select(MEDIA_JOB_COLUMNS)
        .eq("user_id", args.userId)
        .eq("idempotency_key", args.idempotencyKey)
        .single();
      if (raced) return { row: raced as unknown as MediaJobRow, reused: true };
    }
    throw new MediaApiError("No se pudo registrar la generación.", 500, "job_create_failed");
  }
  return { row: data as unknown as MediaJobRow, reused: false };
}

async function failJob(admin: Awaited<ReturnType<typeof requireMediaAdmin>>["admin"], jobId: string, code: string, message: string) {
  await admin.from("media_generation_jobs").update({ status: "failed", error_code: code, error_message: message.slice(0, 300) }).eq("id", jobId);
}

export async function POST(request: NextRequest) {
  let jobId: string | null = null;
  let admin: Awaited<ReturnType<typeof requireMediaAdmin>>["admin"] | null = null;
  try {
    const body = await request.json().catch(() => ({})) as MediaGenerateBody;
    if (!body.type && !body.idempotencyKey) return await legacyImageGeneration(request, body);

    const authenticated = await requireMediaAdmin(request);
    admin = authenticated.admin;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new MediaApiError("GEMINI_API_KEY no está configurada.", 500, "missing_api_key");
    const prompt = validatePrompt(body.prompt);
    if (body.type !== "image" && body.type !== "video") throw new MediaApiError("Tipo de creación inválido.", 400, "invalid_media_type");
    if (!body.idempotencyKey || !/^[a-zA-Z0-9_-]{16,96}$/.test(body.idempotencyKey)) {
      throw new MediaApiError("La operación no tiene una clave de idempotencia válida.", 400, "invalid_idempotency_key");
    }
    const sourceMode: MediaSourceMode = body.referenceUrl ? "reference" : "text";
    if (body.sourceMode === "reference" && !body.referenceUrl) {
      throw new MediaApiError("Elegí una imagen de referencia.", 400, "reference_required");
    }

    if (body.type === "image") {
      const quality: ImageQuality = isImageQuality(body.quality) ? body.quality : "high";
      const aspectRatio: ImageAspectRatio = isImageAspectRatio(body.aspectRatio) ? body.aspectRatio : "1:1";
      const config = IMAGE_QUALITY_CONFIG[quality];
      const generationPrompt = await resolveClouvaAIImagePrompt(admin, authenticated.user.id, prompt);
      const created = await createJob({
        admin,
        userId: authenticated.user.id,
        idempotencyKey: body.idempotencyKey,
        type: "image",
        sourceMode,
        prompt,
        model: config.model,
        aspectRatio,
        quality,
        durationSeconds: null,
        referenceStoragePath: body.referenceStoragePath ?? null,
        referenceUrl: body.referenceUrl ?? null,
        estimatedCostUsd: null,
      });
      jobId = created.row.id;
      if (created.reused) return NextResponse.json({ job: toPublicMediaJob(created.row), reused: true });

      const reference = body.referenceUrl ? await downloadReferenceImage(body.referenceUrl) : null;
      const generated = await generateImage({
        apiKey,
        prompt: generationPrompt,
        model: config.model,
        aspectRatio,
        imageSize: config.imageSize,
        referenceImages: reference ? [{ mimeType: reference.mimeType, data: reference.bytes.toString("base64") }] : [],
      });
      await admin.from("media_generation_jobs").update({
        status: "saving",
        operation_id: generated.providerOperationId,
        mime_type: generated.mimeType,
        usage_metadata: generated.usageMetadata,
      }).eq("id", jobId).eq("user_id", authenticated.user.id);

      try {
        const stored = await uploadGeneratedMediaObject({
          bytes: generated.bytes,
          mimeType: generated.mimeType,
          pathPrefix: `media/${authenticated.user.id}/images`,
        });
        const { data: completed, error } = await admin.from("media_generation_jobs").update({
          status: "completed",
          output_storage_path: stored.objectPath,
          output_url: stored.url,
          mime_type: generated.mimeType,
          completed_at: new Date().toISOString(),
        }).eq("id", jobId).eq("user_id", authenticated.user.id).select(MEDIA_JOB_COLUMNS).single();
        if (error || !completed) throw new Error("No se pudo registrar el resultado.");
        return NextResponse.json({ job: toPublicMediaJob(completed as unknown as MediaJobRow) });
      } catch {
        await admin.from("media_generation_jobs").update({
          status: "storage_failed",
          error_code: "storage_failed",
          error_message: "La imagen se generó, pero no pudo guardarse. Podés reintentar el guardado sin volver a generarla.",
        }).eq("id", jobId).eq("user_id", authenticated.user.id);
        throw new MediaApiError("La imagen se generó, pero falló el guardado.", 502, "storage_failed");
      }
    }

    const quality: VideoQuality = isVideoQuality(body.quality) ? body.quality : "fast";
    const aspectRatio: VideoAspectRatio = isVideoAspectRatio(body.aspectRatio) ? body.aspectRatio : "16:9";
    const durationSeconds: VideoDuration = isVideoDuration(body.durationSeconds) ? Number(body.durationSeconds) as VideoDuration : 8;
    const config = VIDEO_QUALITY_CONFIG[quality];
    const estimatedCostUsd = estimateVideoCostUsd(quality, durationSeconds);
    if (typeof body.confirmedCostUsd !== "number" || Math.abs(body.confirmedCostUsd - estimatedCostUsd) > 0.001) {
      throw new MediaApiError("Confirmá el costo estimado antes de generar el video.", 409, "cost_confirmation_required");
    }
    const created = await createJob({
      admin,
      userId: authenticated.user.id,
      idempotencyKey: body.idempotencyKey,
      type: "video",
      sourceMode,
      prompt,
      model: config.model,
      aspectRatio,
      quality,
      durationSeconds,
      referenceStoragePath: body.referenceStoragePath ?? null,
      referenceUrl: body.referenceUrl ?? null,
      estimatedCostUsd,
    });
    jobId = created.row.id;
    if (created.reused) return NextResponse.json({ job: toPublicMediaJob(created.row), reused: true });

    const reference = body.referenceUrl ? await downloadReferenceImage(body.referenceUrl) : null;
    const operation = await startVideoGeneration({
      apiKey,
      prompt,
      model: config.model as GeminiVideoModel,
      aspectRatio,
      durationSeconds,
      resolution: config.resolution,
      referenceImage: reference ? { bytes: reference.bytes, mimeType: reference.mimeType } : undefined,
    });
    const { data: started, error } = await admin.from("media_generation_jobs").update({
      status: operation.done ? "processing" : "generating",
      operation_id: operation.name,
      provider_metadata: operation.metadata ? { operationMetadata: operation.metadata } : {},
    }).eq("id", jobId).eq("user_id", authenticated.user.id).select(MEDIA_JOB_COLUMNS).single();
    if (error || !started) throw new MediaApiError("El video se inició, pero no pudo registrarse.", 500, "job_update_failed");
    return NextResponse.json({ job: toPublicMediaJob(started as unknown as MediaJobRow) }, { status: 202 });
  } catch (error) {
    if (jobId && admin && !(error instanceof MediaApiError && error.code === "storage_failed")) {
      const publicError = publicMediaError(error);
      await failJob(admin, jobId, publicError.body.code, publicError.body.error);
    }
    if (error instanceof GeminiImageError) {
      const mapped = publicMediaError(error);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
