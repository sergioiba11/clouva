import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_CONCURRENT_GENERATIONS,
  TREBOL_MEDIA_BUDGET_SCOPE,
  hashFor,
  isImageGenerationEnabled,
  finalizeBudget,
  releaseBudget,
  reserveBudget,
} from "@/lib/ai-budget/budget-service";
import { estimateFinalCostUsd, estimateImageCostUsd } from "@/lib/ai-budget/gemini-pricing";
import {
  GeminiImageError,
  generateImage,
  type GeminiAspectRatio,
  type GeminiImageModel,
} from "@/lib/gemini-image";
import { uploadGeneratedMedia } from "@/lib/gcs-media";

const ASPECT_RATIOS = new Set<GeminiAspectRatio>([
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9",
]);
const IMAGE_MODELS = new Set<GeminiImageModel>([
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
]);
const RESOLUTION = "1K" as const;

type GenerateTrebolImageArgs = {
  prompt: string;
  aspectRatio?: string;
  transport: "text" | "live";
  conversationId: string | null;
};

function mediaModel(): GeminiImageModel {
  const configured = process.env.GEMINI_IMAGE_MODEL?.trim() as GeminiImageModel | undefined;
  if (configured && IMAGE_MODELS.has(configured)) return configured;
  return "gemini-3.1-flash-image";
}

function storagePath(url: string): string {
  try {
    return new URL(url).pathname.split("/").slice(2).join("/");
  } catch {
    return "";
  }
}

function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export class TrebolMediaService {
  constructor(
    private readonly userSupabase: SupabaseClient,
    private readonly admin: SupabaseClient,
    private readonly userId: string,
  ) {}

  private async assertAdmin() {
    const { data, error } = await this.userSupabase.rpc("clouva_control_is_admin");
    if (error || data !== true) {
      throw statusError("CLOUVA CONTROL no autorizó la generación multimedia para este usuario.", 403);
    }
  }

  async generateImage(args: GenerateTrebolImageArgs) {
    await this.assertAdmin();
    if (!isImageGenerationEnabled()) throw statusError("La generación de imágenes está desactivada.", 503);

    const prompt = args.prompt.trim();
    if (!prompt) throw statusError("La imagen necesita un prompt.", 400);
    if (prompt.length > 4_000) throw statusError("El prompt de imagen es demasiado largo.", 413);
    const aspectRatio = ASPECT_RATIOS.has(args.aspectRatio as GeminiAspectRatio)
      ? args.aspectRatio as GeminiAspectRatio
      : "1:1";
    const model = mediaModel();
    const idempotencyKey = hashFor(["trebol-image-v1", this.userId, prompt, model, aspectRatio].join("::"));

    const { data: existing, error: existingError } = await this.admin
      .from("media_generation_jobs")
      .select("id,status,output_url,mime_type,actual_cost_usd")
      .eq("user_id", this.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.status === "completed" && existing.output_url) {
      return {
        kind: "image",
        status: "reused",
        jobId: existing.id,
        url: existing.output_url,
        mimeType: existing.mime_type ?? "image/png",
        model,
        aspectRatio,
        costUsd: 0,
      };
    }
    if (existing && ["queued", "generating", "processing", "saving"].includes(existing.status)) {
      return { kind: "image", status: existing.status, jobId: existing.id, model, aspectRatio };
    }
    if (existing) {
      throw statusError("Una generación idéntica ya falló o fue cancelada. Ajustá el prompt para crear una solicitud nueva.", 409);
    }

    const { count: activeCountValue, error: activeCountError } = await this.admin
      .from("media_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("type", "image")
      .in("status", ["queued", "generating", "processing", "saving"]);
    if (activeCountError) throw new Error(activeCountError.message);
    const activeCount = activeCountValue ?? 0;
    if (activeCount >= MAX_CONCURRENT_GENERATIONS) {
      throw statusError(`Ya hay ${activeCount} generaciones de Trébol en curso.`, 429);
    }

    const estimatedCostUsd = estimateImageCostUsd(model, RESOLUTION);
    const reservation = await reserveBudget(this.admin, {
      scope: TREBOL_MEDIA_BUDGET_SCOPE,
      estimatedCostUsd,
      useReserve: false,
    });
    if (!reservation.allowed) {
      throw statusError(`El presupuesto de imágenes de Trébol no está disponible (${reservation.reason}).`, 402);
    }

    const { data: job, error: jobError } = await this.admin
      .from("media_generation_jobs")
      .insert({
        user_id: this.userId,
        idempotency_key: idempotencyKey,
        type: "image",
        source_mode: "text",
        status: "generating",
        prompt,
        model,
        aspect_ratio: aspectRatio,
        quality: RESOLUTION,
        estimated_cost_usd: estimatedCostUsd,
        started_at: new Date().toISOString(),
        provider_metadata: {
          provider: "gemini",
          transport: args.transport,
          conversationId: args.conversationId,
          budgetScope: TREBOL_MEDIA_BUDGET_SCOPE,
        },
      })
      .select("id")
      .single();
    if (jobError || !job) {
      await releaseBudget(this.admin, { scope: TREBOL_MEDIA_BUDGET_SCOPE, estimatedCostUsd });
      if (jobError?.code === "23505") {
        throw statusError("Esta generación ya fue registrada; esperá su resultado antes de repetirla.", 409);
      }
      throw new Error(jobError?.message ?? "No se pudo registrar la generación de imagen.");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await releaseBudget(this.admin, { scope: TREBOL_MEDIA_BUDGET_SCOPE, estimatedCostUsd });
      await this.admin.from("media_generation_jobs").update({ status: "failed", error_code: "MODEL_UNAVAILABLE", error_message: "GEMINI_API_KEY no configurada." }).eq("id", job.id);
      throw statusError("GEMINI_API_KEY no está configurada en Cloud Run.", 503);
    }

    let generated: Awaited<ReturnType<typeof generateImage>>;
    try {
      generated = await generateImage({ apiKey, prompt, model, aspectRatio });
    } catch (error) {
      await releaseBudget(this.admin, { scope: TREBOL_MEDIA_BUDGET_SCOPE, estimatedCostUsd });
      const message = error instanceof Error ? error.message : "Falló la generación de imagen.";
      await this.admin.from("media_generation_jobs").update({
        status: "failed",
        error_code: error instanceof GeminiImageError ? `GEMINI_${error.status}` : "MODEL_UNAVAILABLE",
        error_message: message.slice(0, 500),
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
      throw error;
    }

    const actualCostUsd = estimateFinalCostUsd({
      model,
      resolution: RESOLUTION,
      promptTokenCount: generated.usageMetadata?.promptTokenCount,
      candidatesTokenCount: generated.usageMetadata?.candidatesTokenCount,
      thoughtsTokenCount: generated.usageMetadata?.thoughtsTokenCount,
    });
    await finalizeBudget(this.admin, {
      scope: TREBOL_MEDIA_BUDGET_SCOPE,
      estimatedCostUsd,
      actualCostUsd,
    });

    try {
      await this.admin.from("media_generation_jobs").update({ status: "saving", actual_cost_usd: actualCostUsd }).eq("id", job.id);
      const url = await uploadGeneratedMedia({
        bytes: generated.bytes,
        mimeType: generated.mimeType,
        pathPrefix: `trebol/${this.userId}/images`,
      });
      const { error: completionError } = await this.admin.from("media_generation_jobs").update({
        status: "completed",
        output_storage_path: storagePath(url),
        output_url: url,
        mime_type: generated.mimeType,
        usage_metadata: generated.usageMetadata ?? {},
        actual_cost_usd: actualCostUsd,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      if (completionError) throw new Error(completionError.message);
      return {
        kind: "image",
        status: "completed",
        jobId: job.id,
        url,
        mimeType: generated.mimeType,
        model,
        aspectRatio,
        costUsd: actualCostUsd,
        text: generated.text,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar la imagen.";
      await this.admin.from("media_generation_jobs").update({
        status: "storage_failed",
        actual_cost_usd: actualCostUsd,
        error_code: "MEDIA_STORAGE_ERROR",
        error_message: message.slice(0, 500),
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
      throw error;
    }
  }
}
