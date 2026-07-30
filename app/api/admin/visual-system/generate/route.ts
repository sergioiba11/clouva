import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { GeminiImageError, generateImage } from "@/lib/gemini-image";
import { uploadGeneratedMedia } from "@/lib/gcs-media";
import { normalizeRole } from "@/lib/auth";
import {
  MAX_CONCURRENT_GENERATIONS,
  MAX_RETRIES_PER_ASSET,
  VISUAL_REDESIGN_BUDGET_SCOPE,
  countActiveGenerations,
  findReusableJob,
  finalizeBudget,
  hashFor,
  isImageGenerationEnabled,
  releaseBudget,
  reserveBudget,
} from "@/lib/ai-budget/budget-service";
import { estimateFinalCostUsd, estimateImageCostUsd } from "@/lib/ai-budget/gemini-pricing";
import { assetManifest, manifestEntry } from "@/lib/ai-budget/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireAdmin(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) {
    const error = new Error("Sesión requerida.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  const admin = getAdminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    const error = new Error("Sesión inválida.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (normalizeRole(profile?.role) !== "admin") {
    const error = new Error("Necesitás permisos de administrador para generar recursos visuales.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return { admin, userId: userData.user.id };
}

export async function POST(request: NextRequest) {
  let admin: ReturnType<typeof getAdminClient>;
  try {
    ({ admin } = await requireAdmin(request));
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }

  try {
    if (!isImageGenerationEnabled()) {
      return NextResponse.json(
        { error: "La generación de imágenes está desactivada (GEMINI_IMAGE_GENERATION_ENABLED=false). Los recursos existentes siguen disponibles." },
        { status: 503 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 500 });

    const body = (await request.json().catch(() => ({}))) as { assetKey?: string; useReserve?: boolean };
    if (!body.assetKey) return NextResponse.json({ error: "Falta assetKey." }, { status: 400 });

    let entry: ReturnType<typeof manifestEntry>;
    try {
      entry = manifestEntry(body.assetKey);
    } catch {
      return NextResponse.json({ error: `"${body.assetKey}" no tiene una entrada aprobada en el manifiesto.` }, { status: 400 });
    }

    const promptHash = hashFor(entry.prompt);
    const inputHash = hashFor(JSON.stringify({ references: entry.references, aspectRatio: entry.aspectRatio }));
    const idempotencyKey = hashFor([entry.assetKey, promptHash, inputHash, entry.model, entry.resolution].join("::"));

    // Reuse: an identical completed generation already exists -- never pay twice.
    const reusable = await findReusableJob(admin, {
      promptHash,
      inputHash,
      model: entry.model,
      resolution: entry.resolution,
    });
    if (reusable?.output_path) {
      return NextResponse.json({
        assetKey: entry.assetKey,
        status: "reused",
        outputPath: reusable.output_path,
        costUsd: 0,
      });
    }

    const activeCount = await countActiveGenerations(admin);
    if (activeCount >= MAX_CONCURRENT_GENERATIONS) {
      return NextResponse.json({ error: `Ya hay ${activeCount} generaciones en curso (máximo ${MAX_CONCURRENT_GENERATIONS}).` }, { status: 429 });
    }

    const { data: existingJob } = await admin
      .from("ai_image_generation_jobs")
      .select("id, retry_count")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingJob && existingJob.retry_count >= MAX_RETRIES_PER_ASSET) {
      return NextResponse.json({ error: `"${entry.assetKey}" ya alcanzó el máximo de ${MAX_RETRIES_PER_ASSET} reintentos.` }, { status: 409 });
    }

    const estimatedCostUsd = Math.min(estimateImageCostUsd(entry.model, entry.resolution), entry.maxCostUsd * 3);
    const reservation = await reserveBudget(admin, {
      estimatedCostUsd,
      useReserve: Boolean(body.useReserve),
    });

    if (!reservation.allowed) {
      await admin.from("ai_image_generation_jobs").upsert(
        {
          scope: VISUAL_REDESIGN_BUDGET_SCOPE,
          purpose: entry.purpose,
          page: entry.page,
          asset_type: entry.section,
          prompt_hash: promptHash,
          input_hash: inputHash,
          idempotency_key: idempotencyKey,
          model: entry.model,
          resolution: entry.resolution,
          estimated_cost_usd: estimatedCostUsd,
          status: "blocked_budget",
          error_code: reservation.reason,
          requested_by: null,
        },
        { onConflict: "idempotency_key" },
      );
      return NextResponse.json(
        { error: `Presupuesto no disponible (${reservation.reason}).`, budget: reservation },
        { status: 402 },
      );
    }

    const { data: job, error: jobError } = await admin
      .from("ai_image_generation_jobs")
      .upsert(
        {
          scope: VISUAL_REDESIGN_BUDGET_SCOPE,
          purpose: entry.purpose,
          page: entry.page,
          asset_type: entry.section,
          prompt_hash: promptHash,
          input_hash: inputHash,
          idempotency_key: idempotencyKey,
          model: entry.model,
          resolution: entry.resolution,
          estimated_cost_usd: estimatedCostUsd,
          status: "generating",
          retry_count: existingJob ? existingJob.retry_count + 1 : 0,
        },
        { onConflict: "idempotency_key" },
      )
      .select("id")
      .single();
    if (jobError || !job) {
      await releaseBudget(admin, { estimatedCostUsd });
      throw new Error(jobError?.message ?? "No se pudo registrar el job de generación.");
    }

    // Split deliberately into two stages with two different failure-cost
    // rules: if generateImage() itself throws, Gemini never billed us
    // (release the reservation, $0 spent). But once generateImage() returns,
    // Google has already charged for that call regardless of what happens
    // next -- a later upload failure must NOT release the reservation as
    // free, or the ledger silently under-counts real spend.
    let generated: Awaited<ReturnType<typeof generateImage>>;
    try {
      generated = await generateImage({
        apiKey,
        prompt: entry.prompt,
        model: entry.model,
        aspectRatio: entry.aspectRatio,
      });
    } catch (generationError) {
      await releaseBudget(admin, { estimatedCostUsd });
      const message = generationError instanceof Error ? generationError.message : "Fallo desconocido";
      await admin
        .from("ai_image_generation_jobs")
        .update({ status: "failed", error_code: message.slice(0, 200) })
        .eq("id", job.id);
      throw generationError;
    }

    const actualCostUsd = estimateFinalCostUsd({
      model: entry.model,
      resolution: entry.resolution,
      promptTokenCount: generated.usageMetadata?.promptTokenCount,
      candidatesTokenCount: generated.usageMetadata?.candidatesTokenCount,
      thoughtsTokenCount: generated.usageMetadata?.thoughtsTokenCount,
    });
    await finalizeBudget(admin, { estimatedCostUsd, actualCostUsd });

    try {
      const url = await uploadGeneratedMedia({
        bytes: generated.bytes,
        mimeType: generated.mimeType,
        pathPrefix: `${entry.outputPathPrefix}/${entry.assetKey}`,
      });

      await admin
        .from("ai_image_generation_jobs")
        .update({
          status: "completed",
          actual_cost_usd: actualCostUsd,
          output_path: url,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return NextResponse.json({
        assetKey: entry.assetKey,
        status: "completed",
        outputPath: url,
        costUsd: actualCostUsd,
        model: entry.model,
      });
    } catch (uploadError) {
      // Budget already finalized above -- Gemini was paid, do not refund it.
      const message = uploadError instanceof Error ? uploadError.message : "Fallo al guardar el recurso";
      await admin
        .from("ai_image_generation_jobs")
        .update({ status: "failed", actual_cost_usd: actualCostUsd, error_code: message.slice(0, 200) })
        .eq("id", job.id);
      throw uploadError;
    }
  } catch (error) {
    if (error instanceof GeminiImageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "No se pudo generar el recurso.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
  return NextResponse.json({ manifest: assetManifest.map((entry) => ({ assetKey: entry.assetKey, page: entry.page, priority: entry.priority })) });
}
