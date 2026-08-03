import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { studioMembershipPlansSelect } from "@/lib/players-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOIN_POLICIES = new Set(["automatic", "approval", "invitation_only"]);

function cleanKey(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return key || fallback;
}

function cleanLabel(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function sanitizePlanInput(body: unknown) {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 100) : "";
  if (!name) throw new Error("El nombre del plan es obligatorio.");

  const slugSource = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug : name;
  const slug = slugSource.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!slug) throw new Error("No se pudo generar un slug para el plan.");

  const isFree = Boolean(raw.isFree);
  let price: number | null = null;
  let billingInterval: "month" | "year" | null = null;
  if (!isFree) {
    price = Number(raw.price);
    if (!Number.isFinite(price) || price < 0) throw new Error("El precio tiene que ser un número mayor o igual a 0.");
    billingInterval = raw.billingInterval === "year" ? "year" : "month";
  }

  const benefits = Array.isArray(raw.benefits)
    ? raw.benefits.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 200)).slice(0, 20)
    : [];
  const publicRoleLabel = cleanLabel(raw.publicRoleLabel, isFree ? "Artista" : name);
  const areaLabel = cleanLabel(raw.areaLabel, isFree ? "Artística" : "Creativa");
  const joinPolicy = typeof raw.joinPolicy === "string" && JOIN_POLICIES.has(raw.joinPolicy) ? raw.joinPolicy : "automatic";

  return {
    name,
    slug,
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 2000) || null : null,
    price,
    currency: typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim().slice(0, 3).toUpperCase() : "ARS",
    billing_interval: billingInterval,
    is_free: isFree,
    is_active: raw.isActive === undefined ? true : Boolean(raw.isActive),
    is_public: raw.isPublic === undefined ? true : Boolean(raw.isPublic),
    benefits,
    public_role_key: cleanKey(raw.publicRoleKey, isFree ? "artist" : cleanKey(publicRoleLabel, "member")),
    public_role_label: publicRoleLabel,
    area_key: cleanKey(raw.areaKey, isFree ? "artistic" : cleanKey(areaLabel, "creative")),
    area_label: areaLabel,
    join_policy: joinPolicy,
    requires_approval: joinPolicy === "approval" || Boolean(raw.requiresApproval),
    display_badge: cleanLabel(raw.displayBadge, publicRoleLabel.toUpperCase()),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });

    const { data, error } = await admin.from("studio_membership_plans").select(studioMembershipPlansSelect).eq("studio_id", studioId).order("display_order");
    if (error) throw new Error(error.message);
    return NextResponse.json({ plans: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los planes." }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });
    const values = sanitizePlanInput(await request.json().catch(() => ({})));

    const { data: last } = await admin.from("studio_membership_plans").select("display_order").eq("studio_id", studioId).order("display_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await admin
      .from("studio_membership_plans")
      .insert({ ...values, studio_id: studioId, created_by: user.id, display_order: ((last?.display_order as number | null) ?? -1) + 1 })
      .select(studioMembershipPlansSelect)
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Ya existe un plan con ese nombre en este Estudio.");
      throw new Error(error.message);
    }
    return NextResponse.json({ plan: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo crear el plan.";
    return NextResponse.json({ error: message }, { status: message.includes("obligatorio") || message.includes("número") || message.includes("existe") ? 400 : status });
  }
}
