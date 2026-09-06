import { NextRequest, NextResponse } from "next/server";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderRow = { id: string; sales_channel: string; created_at: string };
type ItemRow = { order_id: string; product_id: string; quantity: number; total: number };
type PaymentRow = { order_id: string; fee_amount: number };
type MovementRow = {
  listing_id: string;
  movement_type: string;
  quantity_delta: number;
  unit_cost: number | null;
  created_at: string;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });

    const { data: products, error } = await admin
      .from("commerce_products")
      .select("id,name,description,price,currency,stock,status,cover_url,gallery,spot_id,owner_type,player_id,studio_id,product_type,listing_kind,cost_amount,updated_at")
      .eq("spot_id", spotId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const productIds = (products ?? []).map((product) => product.id);
    if (!productIds.length) return NextResponse.json({ products: [] });

    const [{ data: variants, error: variantsError }, { data: movements, error: movementsError }, { data: orders, error: ordersError }] = await Promise.all([
      admin
        .from("commerce_product_variants")
        .select("id,product_id,sku,title,size,color,price_override,cost_override,stock,active")
        .in("product_id", productIds)
        .eq("active", true)
        .order("created_at"),
      admin
        .from("commerce_inventory_movements")
        .select("listing_id,movement_type,quantity_delta,unit_cost,created_at")
        .eq("spot_id", spotId)
        .in("listing_id", productIds)
        .order("created_at"),
      admin
        .from("commerce_orders")
        .select("id,sales_channel,created_at")
        .eq("spot_id", spotId)
        .eq("payment_status", "paid")
        .order("created_at"),
    ]);
    if (variantsError) throw new Error(variantsError.message);
    if (movementsError) throw new Error(movementsError.message);
    if (ordersError) throw new Error(ordersError.message);

    const orderRows = (orders ?? []) as OrderRow[];
    const orderIds = orderRows.map((order) => order.id);
    let itemRows: ItemRow[] = [];
    let paymentRows: PaymentRow[] = [];
    if (orderIds.length) {
      const [{ data: items, error: itemsError }, { data: payments, error: paymentsError }] = await Promise.all([
        admin.from("commerce_order_items").select("order_id,product_id,quantity,total").in("order_id", orderIds).in("product_id", productIds),
        admin.from("commerce_payments").select("order_id,fee_amount").in("order_id", orderIds).eq("status", "confirmed"),
      ]);
      if (itemsError) throw new Error(itemsError.message);
      if (paymentsError) throw new Error(paymentsError.message);
      itemRows = (items ?? []) as ItemRow[];
      paymentRows = (payments ?? []) as PaymentRow[];
    }

    const orderById = new Map(orderRows.map((order) => [order.id, order]));
    const paymentFeeByOrder = new Map(paymentRows.map((payment) => [payment.order_id, Number(payment.fee_amount || 0)]));
    const orderGross = new Map<string, number>();
    for (const item of itemRows) orderGross.set(item.order_id, (orderGross.get(item.order_id) ?? 0) + Number(item.total || 0));

    const result = (products ?? []).map((product) => {
      const productMovements = (movements ?? []).filter((movement) => movement.listing_id === product.id) as MovementRow[];
      const purchaseReceipts = productMovements.filter((movement) => movement.movement_type === "purchase_receipt" && Number(movement.quantity_delta) > 0);
      const saleMovements = productMovements.filter((movement) => movement.movement_type === "sale" && Number(movement.quantity_delta) < 0);
      const productItems = itemRows.filter((item) => item.product_id === product.id);

      const unitsPurchased = purchaseReceipts.reduce((sum, movement) => sum + Number(movement.quantity_delta || 0), 0);
      const capitalInvested = purchaseReceipts.reduce((sum, movement) => sum + Number(movement.quantity_delta || 0) * Number(movement.unit_cost || 0), 0);
      const unitsSold = saleMovements.reduce((sum, movement) => sum + Math.abs(Number(movement.quantity_delta || 0)), 0);
      const costOfGoods = saleMovements.reduce((sum, movement) => sum + Math.abs(Number(movement.quantity_delta || 0)) * Number(movement.unit_cost || 0), 0);
      const grossRevenue = productItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
      const allocatedFees = productItems.reduce((sum, item) => {
        const gross = orderGross.get(item.order_id) ?? 0;
        if (gross <= 0) return sum;
        return sum + (paymentFeeByOrder.get(item.order_id) ?? 0) * (Number(item.total || 0) / gross);
      }, 0);
      const salesByChannel: Record<string, number> = {};
      for (const item of productItems) {
        const channel = orderById.get(item.order_id)?.sales_channel || "unknown";
        salesByChannel[channel] = (salesByChannel[channel] ?? 0) + Number(item.quantity || 0);
      }
      const latestPurchase = [...purchaseReceipts].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

      return {
        ...product,
        variants: (variants ?? []).filter((variant) => variant.product_id === product.id),
        metrics: {
          restockCycles: purchaseReceipts.length,
          unitsPurchased,
          unitsSold,
          capitalInvested,
          grossRevenue,
          costOfGoods,
          allocatedFees,
          realizedProfit: grossRevenue - costOfGoods - allocatedFees,
          latestUnitCost: latestPurchase?.unit_cost ?? product.cost_amount ?? null,
          lastPurchaseAt: latestPurchase?.created_at ?? null,
          salesByChannel,
        },
      };
    });

    return NextResponse.json({ products: result });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudieron cargar los productos del espacio.",
      ...(typed.code ? { code: typed.code } : {}),
    }, { status });
  }
}
