import { NextRequest, NextResponse } from "next/server";
import { enqueueFacebookPublisherBatch } from "@/lib/server/cloud-tasks";
import {
  confirmPublicationJob,
  controlPublicationBatch,
  createPublicationBatch,
  getFacebookPublisherOverview,
  saveFacebookDestination,
  saveFacebookProductDestination,
  savePublicationVariant,
} from "@/lib/server/facebook-publisher";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const typed = error as Error & { status?: number; code?: string };
  return NextResponse.json({
    error: error instanceof Error ? error.message : "No se pudo completar la operación.",
    ...(typed.code ? { code: typed.code } : {}),
  }, { status: typed.status ?? (isAuthError(error) ? 401 : 500) });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spaceId } = await params;
    const admin = createAdminSupabase();
    const overview = await getFacebookPublisherOverview({ admin, userId: user.id, spaceId });
    return NextResponse.json(overview);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spaceId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const admin = createAdminSupabase();

    if (action === "save_destination") {
      const destination = await saveFacebookDestination({
        admin,
        userId: user.id,
        spaceId,
        destination: (body.destination ?? {}) as Parameters<typeof saveFacebookDestination>[0]["destination"],
      });
      return NextResponse.json({ destination });
    }

    if (action === "save_product_destination") {
      const config = await saveFacebookProductDestination({
        admin,
        userId: user.id,
        spaceId,
        productId: String(body.productId ?? ""),
        destinationId: body.destinationId ? String(body.destinationId) : null,
        destinationType: body.destinationType as "marketplace" | "group" | "page" | undefined,
        enabled: body.enabled !== false,
        variantId: body.variantId ? String(body.variantId) : null,
        customText: typeof body.customText === "string" ? body.customText : null,
        primaryImageUrl: typeof body.primaryImageUrl === "string" ? body.primaryImageUrl : null,
        imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter((value): value is string => typeof value === "string") : [],
      });
      return NextResponse.json({ config });
    }

    if (action === "save_variant") {
      const variant = await savePublicationVariant({
        admin,
        userId: user.id,
        spaceId,
        variant: (body.variant ?? {}) as Parameters<typeof savePublicationVariant>[0]["variant"],
      });
      return NextResponse.json({ variant });
    }

    if (action === "create_batch") {
      const result = await createPublicationBatch({
        admin,
        userId: user.id,
        spaceId,
        productIds: Array.isArray(body.productIds) ? body.productIds.map(String) : [],
        scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : null,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      });
      if (!result.duplicate) {
        await enqueueFacebookPublisherBatch(String(result.batch.id), String(result.batch.scheduled_at ?? ""));
      }
      return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
    }

    if (["pause", "resume", "cancel", "retry_failed"].includes(action)) {
      const batchId = String(body.batchId ?? "");
      const batch = await controlPublicationBatch({
        admin,
        userId: user.id,
        spaceId,
        batchId,
        action: action as "pause" | "resume" | "cancel" | "retry_failed",
      });
      if (action === "resume" || action === "retry_failed") {
        await enqueueFacebookPublisherBatch(batchId);
      }
      return NextResponse.json({ batch });
    }

    if (action === "confirm_job") {
      const job = await confirmPublicationJob({
        admin,
        userId: user.id,
        spaceId,
        jobId: String(body.jobId ?? ""),
        publishedUrl: typeof body.publishedUrl === "string" ? body.publishedUrl : null,
      });
      return NextResponse.json({ job });
    }

    return NextResponse.json({ error: "Acción de publicador inválida." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
