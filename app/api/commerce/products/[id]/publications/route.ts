import { NextRequest, NextResponse } from "next/server";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { getSpaceAdminEligibility, requireSpaceAdminPlan } from "@/lib/server/space-access";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_SPACE_ROLES = new Set(["owner", "admin", "manager", "catalog", "content"]);
const MODES = new Set(["automatic", "assisted", "manual"]);
const STATUSES = new Set([
  "draft", "ready", "publishing", "published", "needs_user_action", "failed",
  "paused", "sold", "removed", "unavailable", "needs_removal",
]);

type PublicationTarget = "player" | "space" | "marketplace";

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalUrl(value: unknown) {
  const raw = short(value, 2000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function channelName(value: unknown, fallback: string) {
  const raw = short(value, 50).toLowerCase();
  return /^[a-z0-9_]+$/.test(raw) ? raw : fallback;
}

async function controlledPlayerIds(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const [owned, memberships] = await Promise.all([
    admin.from("players").select("id").eq("owner_user_id", userId),
    admin.from("player_members").select("player_id").eq("user_id", userId).eq("status", "active").in("role", ["owner", "manager", "editor"]),
  ]);
  if (owned.error) throw new Error(owned.error.message);
  if (memberships.error) throw new Error(memberships.error.message);
  return new Set<string>([
    ...(owned.data ?? []).map((row) => String(row.id)),
    ...(memberships.data ?? []).map((row) => String(row.player_id)),
  ]);
}

async function requireProductContentAccess(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  userId: string;
  productId: string;
}) {
  const { data: product, error } = await args.admin
    .from("commerce_products")
    .select("id,owner_type,player_id,studio_id,owner_user_id,spot_id,product_type,listing_kind,name,description,price,currency,stock,status,cover_url,gallery,metadata")
    .eq("id", args.productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!product) {
    const notFound = new Error("El producto no existe.") as Error & { status?: number };
    notFound.status = 404;
    throw notFound;
  }

  if (product.spot_id) {
    await requireSpotAccess({ admin: args.admin, userId: args.userId, spotId: product.spot_id, capability: "content" });
    return product;
  }
  if (product.studio_id) {
    const permission = await requireStudioManager({ admin: args.admin, userId: args.userId, studioId: product.studio_id });
    if (!["owner", "admin", "manager", "editor"].includes(String(permission.role))) {
      const denied = new Error("Tu rol no permite publicar este producto.") as Error & { status?: number; code?: string };
      denied.status = 403;
      denied.code = "SPACE_ROLE_FORBIDDEN";
      throw denied;
    }
    return product;
  }

  const eligibility = await getSpaceAdminEligibility({ admin: args.admin, userId: args.userId });
  if (eligibility.isGlobalAdmin) return product;
  const controlled = await controlledPlayerIds(args.admin, args.userId);
  if (product.player_id && controlled.has(String(product.player_id))) return product;
  if (product.owner_user_id === args.userId) return product;

  const denied = new Error("No tenés permiso para publicar este producto.") as Error & { status?: number };
  denied.status = 403;
  throw denied;
}

async function requireTargetAccess(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  userId: string;
  targetType: PublicationTarget;
  targetPlayerId?: string | null;
  targetSpaceId?: string | null;
}) {
  // Marketplace/channel publications belong to the product itself. Product
  // content access was already checked, so no second identity is required.
  if (args.targetType === "marketplace") return;

  const eligibility = await getSpaceAdminEligibility({ admin: args.admin, userId: args.userId });
  if (eligibility.isGlobalAdmin) return;
  const controlled = await controlledPlayerIds(args.admin, args.userId);

  if (args.targetType === "player") {
    if (args.targetPlayerId && controlled.has(args.targetPlayerId)) return;
  } else if (args.targetType === "space" && args.targetSpaceId) {
    const { data: memberships, error } = await args.admin
      .from("space_members")
      .select("player_id,role,status")
      .eq("space_id", args.targetSpaceId)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    if ((memberships ?? []).some((membership) => controlled.has(String(membership.player_id)) && CONTENT_SPACE_ROLES.has(String(membership.role)))) return;
  }

  const denied = new Error("No tenés permiso para publicar en ese destino.") as Error & { status?: number; code?: string };
  denied.status = 403;
  denied.code = "PUBLICATION_TARGET_FORBIDDEN";
  throw denied;
}

const SELECT = "id,product_id,target_type,target_player_id,target_space_id,placement,is_visible,display_order,source,channel,destination_key,destination_label,destination_url,publication_mode,status,external_id,external_url,published_at,last_sync_at,channel_title,channel_description,price_snapshot,currency_snapshot,stock_snapshot,error,metadata,created_at,updated_at";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id: productId } = await params;
    const admin = createAdminSupabase();
    await requireProductContentAccess({ admin, userId: user.id, productId });
    const { data, error } = await admin
      .from("commerce_product_publications")
      .select(SELECT)
      .eq("product_id", productId)
      .order("display_order")
      .order("created_at");
    if (error) throw new Error(error.message);
    return NextResponse.json({ publications: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las publicaciones." }, { status });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id: productId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      targetType?: PublicationTarget;
      targetPlayerId?: string | null;
      targetSpaceId?: string | null;
      placement?: string;
      isVisible?: boolean;
      displayOrder?: number;
      channel?: string;
      destinationKey?: string | null;
      destinationLabel?: string | null;
      destinationUrl?: string | null;
      publicationMode?: string;
      status?: string;
      externalId?: string | null;
      externalUrl?: string | null;
      channelTitle?: string | null;
      channelDescription?: string | null;
      priceSnapshot?: number | null;
      currencySnapshot?: string | null;
      stockSnapshot?: number | null;
      metadata?: Record<string, unknown> | null;
    };

    const targetType = body.targetType;
    if (!targetType || !["player", "space", "marketplace"].includes(targetType)) {
      return NextResponse.json({ error: "Destino de publicación inválido." }, { status: 400 });
    }
    if (targetType === "player" && !body.targetPlayerId) return NextResponse.json({ error: "Falta el Player destino." }, { status: 400 });
    if (targetType === "space" && !body.targetSpaceId) return NextResponse.json({ error: "Falta el espacio destino." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireSpaceAdminPlan({ admin, userId: user.id });
    const product = await requireProductContentAccess({ admin, userId: user.id, productId });
    await requireTargetAccess({ admin, userId: user.id, targetType, targetPlayerId: body.targetPlayerId, targetSpaceId: body.targetSpaceId });

    const defaultChannel = targetType === "marketplace" ? "clouva_market" : "clouva";
    const channel = channelName(body.channel, defaultChannel);
    const mode = MODES.has(String(body.publicationMode)) ? String(body.publicationMode) : channel === "clouva_market" || channel === "clouva" ? "automatic" : "assisted";
    const visible = body.isVisible !== false;
    const nextStatus = STATUSES.has(String(body.status))
      ? String(body.status)
      : visible
        ? (mode === "automatic" ? "published" : "ready")
        : "draft";
    const destinationKey = targetType === "marketplace"
      ? short(body.destinationKey, 500) || (channel === "facebook_marketplace" || channel === "clouva_market" ? "default" : "")
      : "";
    if (targetType === "marketplace" && channel === "facebook_group" && !destinationKey) {
      return NextResponse.json({ error: "El grupo necesita un identificador o URL." }, { status: 400 });
    }

    const placement = short(body.placement, 40) || "merch";
    let existingQuery = admin
      .from("commerce_product_publications")
      .select("id,metadata,published_at")
      .eq("product_id", productId)
      .eq("target_type", targetType)
      .eq("placement", placement);
    if (targetType === "player") existingQuery = existingQuery.eq("target_player_id", body.targetPlayerId!);
    if (targetType === "space") existingQuery = existingQuery.eq("target_space_id", body.targetSpaceId!);
    if (targetType === "marketplace") {
      existingQuery = existingQuery.eq("channel", channel).eq("destination_key", destinationKey);
    }
    const existing = await existingQuery.maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    const externalUrl = body.externalUrl === null ? null : optionalUrl(body.externalUrl);
    const destinationUrl = body.destinationUrl === null ? null : optionalUrl(body.destinationUrl);
    const row = {
      product_id: productId,
      target_type: targetType,
      target_player_id: targetType === "player" ? body.targetPlayerId : null,
      target_space_id: targetType === "space" ? body.targetSpaceId : null,
      placement,
      is_visible: visible,
      display_order: Number.isFinite(body.displayOrder) ? Math.max(0, Math.trunc(Number(body.displayOrder))) : 0,
      source: "manual",
      channel,
      destination_key: targetType === "marketplace" ? destinationKey : null,
      destination_label: targetType === "marketplace" ? short(body.destinationLabel, 200) || null : null,
      destination_url: targetType === "marketplace" ? destinationUrl : null,
      publication_mode: mode,
      status: nextStatus,
      external_id: short(body.externalId, 300) || null,
      external_url: externalUrl,
      published_at: nextStatus === "published" ? existing.data?.published_at ?? new Date().toISOString() : existing.data?.published_at ?? null,
      last_sync_at: new Date().toISOString(),
      channel_title: short(body.channelTitle, 300) || product.name,
      channel_description: short(body.channelDescription, 5000) || product.description || "",
      price_snapshot: Number.isFinite(body.priceSnapshot) ? Number(body.priceSnapshot) : Number(product.price),
      currency_snapshot: short(body.currencySnapshot, 3).toUpperCase() || product.currency,
      stock_snapshot: Number.isFinite(body.stockSnapshot) ? Math.trunc(Number(body.stockSnapshot)) : product.stock,
      error: nextStatus === "failed" ? "La publicación requiere revisión." : null,
      metadata: {
        ...(existing.data?.metadata && typeof existing.data.metadata === "object" ? existing.data.metadata as Record<string, unknown> : {}),
        ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      },
      created_by_user_id: user.id,
      updated_at: new Date().toISOString(),
    };

    const result = existing.data?.id
      ? await admin.from("commerce_product_publications").update(row).eq("id", existing.data.id).select(SELECT).single()
      : await admin.from("commerce_product_publications").insert(row).select(SELECT).single();
    if (result.error) throw new Error(result.error.message);

    if (targetType === "marketplace" && channel === "clouva_market") {
      const { error: productError } = await admin
        .from("commerce_products")
        .update({ status: visible ? "published" : "draft", updated_at: new Date().toISOString() })
        .eq("id", productId);
      if (productError) throw new Error(productError.message);
    }

    return NextResponse.json({ publication: result.data });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo guardar la publicación.",
      ...(typed.code ? { code: typed.code } : {}),
    }, { status });
  }
}
