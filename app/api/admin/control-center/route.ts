import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RevenueValues = {
  vip: number;
  marketplace: number;
  services: number;
  bookings: number;
};

type RevenueEvent = {
  at: string;
  source: keyof RevenueValues;
  amount: number;
};

type RevenuePoint = RevenueValues & {
  label: string;
  start: string;
  total: number;
};

async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,role_v2")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (profile?.role !== "admin" && profile?.role_v2 !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }

  return { admin, user };
}

function emptyRevenue(): RevenueValues {
  return { vip: 0, marketplace: 0, services: 0, bookings: 0 };
}

function buildRevenueSeries(events: RevenueEvent[], bucketCount: number, bucketMs: number, label: (date: Date, index: number) => string): RevenuePoint[] {
  const endMs = Date.now();
  const startMs = endMs - bucketCount * bucketMs;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = startMs + index * bucketMs;
    const values = emptyRevenue();
    return { bucketStart, values };
  });

  for (const event of events) {
    const time = new Date(event.at).getTime();
    if (!Number.isFinite(time) || time < startMs || time > endMs) continue;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((time - startMs) / bucketMs)));
    buckets[index].values[event.source] += Number(event.amount || 0);
  }

  return buckets.map(({ bucketStart, values }, index) => ({
    label: label(new Date(bucketStart), index),
    start: new Date(bucketStart).toISOString(),
    ...values,
    total: values.vip + values.marketplace + values.services + values.bookings,
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const now = Date.now();

    const [
      profilesCount,
      playersTotal,
      playersPublished,
      studiosTotal,
      studiosPublished,
      subscriptionsResult,
      vipResult,
      paymentsResult,
      serviceOrdersResult,
      commerceOrdersResult,
      bookingsResult,
      productsResult,
      flowWalletsResult,
      membershipsCount,
    ] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("players").select("id", { count: "exact", head: true }),
      admin.from("players").select("id", { count: "exact", head: true }).eq("is_published", true),
      admin.from("studios").select("id", { count: "exact", head: true }),
      admin.from("studios").select("id", { count: "exact", head: true }).eq("is_published", true),
      admin
        .from("billing_subscriptions")
        .select("id,user_id,status,current_period_end,cancel_at_period_end,created_at,billing_products(name,code),billing_prices(amount,currency,billing_interval)")
        .order("created_at", { ascending: false })
        .limit(500),
      admin.from("user_entitlements").select("user_id,valid_until,status").eq("tier", "vip").eq("status", "active").limit(1000),
      admin.from("billing_payments").select("amount,currency,paid_at,user_id").order("paid_at", { ascending: false }).limit(1000),
      admin.from("service_orders").select("total_amount,currency,updated_at,user_id,studio_id,payment_status").eq("payment_status", "paid").order("updated_at", { ascending: false }).limit(1000),
      admin.from("commerce_orders").select("id,total,commission,currency,status,payment_status,fulfillment_status,created_at,paid_at,buyer_id").order("created_at", { ascending: false }).limit(1000),
      admin.from("bookings").select("id,price,currency,status,payment_status,created_at,updated_at,scheduled_at,buyer_id").order("created_at", { ascending: false }).limit(1000),
      admin.from("commerce_products").select("id,name,status,stock,created_at").order("created_at", { ascending: false }).limit(500),
      admin.from("flows_wallets").select("user_id,balance,updated_at").order("balance", { ascending: false }).limit(500),
      admin.from("studio_memberships").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);

    const allResults = [
      profilesCount,
      playersTotal,
      playersPublished,
      studiosTotal,
      studiosPublished,
      subscriptionsResult,
      vipResult,
      paymentsResult,
      serviceOrdersResult,
      commerceOrdersResult,
      bookingsResult,
      productsResult,
      flowWalletsResult,
      membershipsCount,
    ];
    const firstError = allResults.find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);

    const subscriptions = subscriptionsResult.data ?? [];
    const vipUsers = new Set(
      (vipResult.data ?? [])
        .filter((row) => !row.valid_until || new Date(row.valid_until as string).getTime() > now)
        .map((row) => row.user_id as string),
    );
    const paymentRows = paymentsResult.data ?? [];
    const serviceRows = serviceOrdersResult.data ?? [];
    const commerceRows = commerceOrdersResult.data ?? [];
    const bookingRows = bookingsResult.data ?? [];
    const productRows = productsResult.data ?? [];
    const walletRows = flowWalletsResult.data ?? [];

    const paidCommerceRows = commerceRows.filter((row) => row.payment_status === "paid" && row.status !== "refunded");
    const paidBookingRows = bookingRows.filter((row) => row.payment_status === "paid");

    const ingresosVip = paymentRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const ingresosServicios = serviceRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const ingresosMarketplace = paidCommerceRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const ingresosReservas = paidBookingRows.reduce((sum, row) => sum + Number(row.price || 0), 0);
    const ingresos = ingresosVip + ingresosServicios + ingresosMarketplace + ingresosReservas;

    const activeSubscriptions = subscriptions.filter((row) => row.status === "active" || row.status === "authorized");
    const mrr = activeSubscriptions.reduce((sum, row) => {
      const price = row.billing_prices as { amount?: number; billing_interval?: string } | null;
      if (!price) return sum;
      const amount = Number(price.amount || 0);
      return sum + (price.billing_interval === "year" ? amount / 12 : amount);
    }, 0);
    const cancelling = activeSubscriptions.filter((row) => Boolean(row.cancel_at_period_end)).length;

    const ordersToPrepare = paidCommerceRows.filter((row) => ["pending", "preparing", "stock_conflict"].includes(row.fulfillment_status || "pending")).length;
    const ordersPending = commerceRows.filter((row) => row.payment_status !== "paid" && row.status !== "cancelled").length;
    const bookingsPending = bookingRows.filter((row) => row.status === "requested").length;
    const productsPending = productRows.filter((row) => row.status === "pending_review" || row.status === "draft").length;
    const stockCritical = productRows.filter((row) => row.stock != null && Number(row.stock) <= 3 && row.status !== "archived").length;
    const productsPublished = productRows.filter((row) => row.status === "published").length;
    const flowsCirculation = walletRows.reduce((sum, row) => sum + Number(row.balance || 0), 0);

    const userIds = Array.from(new Set([
      ...paymentRows.map((row) => row.user_id),
      ...serviceRows.map((row) => row.user_id),
      ...commerceRows.map((row) => row.buyer_id),
      ...bookingRows.map((row) => row.buyer_id),
    ].filter(Boolean))) as string[];

    const { data: profiles, error: profilesError } = userIds.length
      ? await admin.from("profiles").select("id,full_name,username,email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id as string, profile]));
    const nameOf = (id: string | null | undefined) => {
      if (!id) return "Sistema";
      const profile = profileMap.get(id);
      return profile?.full_name || profile?.username || profile?.email || id.slice(0, 8);
    };

    const activity = [
      ...paymentRows.slice(0, 20).map((row) => ({
        at: row.paid_at as string,
        type: "payment",
        label: "Pago CLOUVA VIP",
        detail: nameOf(row.user_id as string),
        href: "/admin/suscripciones",
      })),
      ...serviceRows.slice(0, 20).map((row) => ({
        at: row.updated_at as string,
        type: "service",
        label: "Servicio de Estudio pagado",
        detail: nameOf(row.user_id as string),
        href: "/admin/estudios",
      })),
      ...commerceRows.slice(0, 20).map((row) => ({
        at: (row.paid_at || row.created_at) as string,
        type: row.payment_status === "paid" ? "order-paid" : "order",
        label: row.payment_status === "paid" ? "Pedido pagado" : "Pedido creado",
        detail: `#${String(row.id).slice(0, 8)} · ${nameOf(row.buyer_id as string)}`,
        href: "/admin/marketplace",
      })),
      ...bookingRows.slice(0, 20).map((row) => ({
        at: (row.updated_at || row.created_at) as string,
        type: "booking",
        label: "Reserva creada",
        detail: nameOf(row.buyer_id as string),
        href: "/admin/reservas",
      })),
    ]
      .filter((item) => item.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 12);

    const revenueEvents: RevenueEvent[] = [
      ...paymentRows.filter((row) => row.paid_at).map((row) => ({ at: row.paid_at as string, source: "vip" as const, amount: Number(row.amount || 0) })),
      ...serviceRows.filter((row) => row.updated_at).map((row) => ({ at: row.updated_at as string, source: "services" as const, amount: Number(row.total_amount || 0) })),
      ...paidCommerceRows.filter((row) => row.paid_at).map((row) => ({ at: row.paid_at as string, source: "marketplace" as const, amount: Number(row.total || 0) })),
      ...paidBookingRows.filter((row) => row.updated_at).map((row) => ({ at: row.updated_at as string, source: "bookings" as const, amount: Number(row.price || 0) })),
    ];

    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const revenueSeries = {
      "24H": buildRevenueSeries(revenueEvents, 12, 2 * hourMs, (date) => date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })),
      "7D": buildRevenueSeries(revenueEvents, 7, dayMs, (date) => date.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit" })),
      "30D": buildRevenueSeries(revenueEvents, 15, 2 * dayMs, (date) => date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })),
      "90D": buildRevenueSeries(revenueEvents, 13, 7 * dayMs, (date) => date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })),
    };

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      stats: {
        ingresos,
        ingresosVip,
        ingresosServicios,
        ingresosMarketplace,
        ingresosReservas,
        usuariosTotales: profilesCount.count ?? 0,
        usuariosVip: vipUsers.size,
        playersTotal: playersTotal.count ?? 0,
        playersPublished: playersPublished.count ?? 0,
        studiosTotal: studiosTotal.count ?? 0,
        studiosPublished: studiosPublished.count ?? 0,
        flowsCirculation,
        activeSubscriptions: activeSubscriptions.length,
        mrr,
        cancellingSubscriptions: cancelling,
        membershipsActive: membershipsCount.count ?? 0,
      },
      commerce: {
        gmv: ingresosMarketplace,
        commissions: paidCommerceRows.reduce((sum, row) => sum + Number(row.commission || 0), 0),
        paidOrders: paidCommerceRows.length,
        ordersToPrepare,
        ordersPending,
        bookingsPending,
        productsPublished,
        productsPending,
        stockCritical,
      },
      attention: {
        playersUnpublished: Math.max((playersTotal.count ?? 0) - (playersPublished.count ?? 0), 0),
        studiosUnpublished: Math.max((studiosTotal.count ?? 0) - (studiosPublished.count ?? 0), 0),
        ordersToPrepare,
        bookingsPending,
        productsPending,
        stockCritical,
      },
      activity,
      revenueSeries,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar CLOUVA Control Center.";
    return NextResponse.json({ error: message }, { status });
  }
}
