import { NextRequest, NextResponse } from "next/server";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { getSpaceAdminEligibility, requireSpaceAdminPlan } from "@/lib/server/space-access";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_SPACE_ROLES = new Set(["owner", "admin", "manager", "catalog", "content"]);

type PublicationTarget = "player" | "space" | "marketplace";

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
    .select("id,owner_type,player_id,studio_id,owner_user_id,spot_id")
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { productId } = await params;
    const admin = createAdminSupabase();
    await requireProductContentAccess({ admin, userId: user.id, productId });
    const { data, error } = await admin
      .from("commerce_product_publications")
      .select("id,product_id,target_type,target_player_id,target_space_id,placement,is_visible,display_order,source,created_at,updated_at")
      .eq("product_id", productId)
      .order("display_order");
    if (error) throw new Error(error.message);
    return NextResponse.json({ publications: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las publicaciones." }, { status });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { productId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      targetType?: PublicationTarget;
      targetPlayerId?: string | null;
      targetSpaceId?: string | null;
      placement?: string;
      isVisible?: boolean;
      displayOrder?: number;
    };
    const targetType = body.targetType;
    if (!targetType || !["player", "space", "marketplace"].includes(targetType)) {
      return NextResponse.json({ error: "Destino de publicación inválido." }, { status: 400 });
    }
    if (targetType === "player" && !body.targetPlayerId) return NextResponse.json({ error: "Falta el Player destino." }, { status: 400 });
    if (targetType === "space" && !body.targetSpaceId) return NextResponse.json({ error: "Falta el espacio destino." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireSpaceAdminPlan({ admin, userId: user.id });
    await requireProductContentAccess({ admin, userId: user.id, productId });
    await requireTargetAccess({ admin, userId: user.id, targetType, targetPlayerId: body.targetPlayerId, targetSpaceId: body.targetSpaceId });

    const row = {
      product_id: productId,
      target_type: targetType,
      target_player_id: targetType === "player" ? body.targetPlayerId : null,
      target_space_id: targetType === "space" ? body.targetSpaceId : null,
      placement: typeof body.placement === "string" && body.placement.trim() ? body.placement.trim().slice(0, 40) : "merch",
      is_visible: body.isVisible !== false,
      display_order: Number.isFinite(body.displayOrder) ? Math.max(0, Math.trunc(Number(body.displayOrder))) : 0,
      source: "manual",
      created_by_user_id: user.id,
      updated_at: new Date().toISOString(),
    };

    let query = admin.from("commerce_product_publications").select("id").eq("product_id", productId).eq("target_type", targetType).eq("placement", row.placement);
    if (targetType === "player") query = query.eq("target_player_id", body.targetPlayerId!);
    if (targetType === "space") query = query.eq("target_space_id", body.targetSpaceId!);
    const existing = await query.maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    const result = existing.data?.id
      ? await admin.from("commerce_product_publications").update(row).eq("id", existing.data.id).select("*").single()
      : await admin.from("commerce_product_publications").insert(row).select("*").single();
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ publication: result.data });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar la publicación.", ...(typed.code ? { code: typed.code } : {}) }, { status });
  }
}
