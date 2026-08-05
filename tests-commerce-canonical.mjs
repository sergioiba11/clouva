import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const foundation = read("./supabase/migrations/20260805230000_commerce_physical_foundation.sql");
const atomic = read("./supabase/migrations/20260805231000_commerce_atomic_payment.sql");
const uniqueness = read("./supabase/migrations/20260805231100_commerce_order_item_uniqueness.sql");
const webhook = read("./app/api/webhooks/mercadopago/commerce-orders/route.ts");

test("canonical commerce stores physical variants instead of flattening size and color", () => {
  assert.match(foundation, /create table if not exists public\.commerce_product_variants/);
  assert.match(foundation, /\bsize text/);
  assert.match(foundation, /\bcolor text/);
  assert.match(foundation, /\bsku text/);
  assert.match(foundation, /\bprice_override numeric/);
  assert.match(foundation, /\bstock integer not null/);
  assert.match(foundation, /add column if not exists variant_id uuid/);
  assert.match(foundation, /add column if not exists sku_snapshot text/);
  assert.match(foundation, /add column if not exists variant_snapshot jsonb/);
});

test("variant stock is the canonical stock source when variants exist", () => {
  assert.match(foundation, /sync_commerce_product_stock_from_variants/);
  assert.match(foundation, /sum\(v\.stock\)/);
  assert.match(foundation, /where v\.product_id = target_product_id/);
  assert.match(foundation, /commerce_product_variants_sync_stock/);
});

test("physical orders have shipment, checkout and fulfillment primitives", () => {
  assert.match(foundation, /create table if not exists public\.commerce_shipments/);
  assert.match(foundation, /delivery_method in \('shipping', 'pickup'\)/);
  assert.match(foundation, /tracking_number text/);
  assert.match(foundation, /label_url text/);
  assert.match(foundation, /add column if not exists shipping_subtotal/);
  assert.match(foundation, /add column if not exists checkout_token uuid/);
  assert.match(foundation, /add column if not exists fulfillment_status text/);
  assert.match(foundation, /commerce_orders_checkout_token_unique/);
  assert.match(foundation, /commerce_orders_external_payment_id_unique/);
});

test("commerce order history is immutable and deduplicable", () => {
  assert.match(foundation, /create table if not exists public\.commerce_order_events/);
  assert.match(foundation, /event_type text not null/);
  assert.match(foundation, /dedupe_key text/);
  assert.match(foundation, /commerce_order_events_dedupe_unique/);
  assert.match(foundation, /commerce_order_events_admin_write/);
});

test("digital delivery has an explicit retryable state", () => {
  assert.match(foundation, /delivery_status text not null default 'pending'/);
  assert.match(foundation, /delivery_claimed_at timestamptz/);
  assert.match(foundation, /delivered_at timestamptz/);
  assert.match(foundation, /'pending', 'processing', 'delivered', 'failed', 'not_applicable'/);
});

test("payment confirmation locks the order and all stock before committing", () => {
  assert.match(atomic, /confirm_commerce_order_payment/);
  assert.match(atomic, /from public\.commerce_orders[\s\S]*for update/);
  assert.match(atomic, /from public\.commerce_products p[\s\S]*for update/);
  assert.match(atomic, /from public\.commerce_product_variants v[\s\S]*for update/);
  assert.match(atomic, /payment_status = 'paid'/);
  assert.match(atomic, /stock_committed_at = now\(\)/);
  assert.match(atomic, /payment_approved_stock_conflict/);
  assert.match(atomic, /on conflict \(order_id, shipment_group\) do nothing/);
});

test("one variant can only occupy one line per order", () => {
  assert.match(uniqueness, /commerce_order_items_order_product_variant_unique/);
  assert.match(uniqueness, /order_id/);
  assert.match(uniqueness, /product_id/);
  assert.match(uniqueness, /coalesce\(variant_id/);
});

test("refund restores committed stock once and revokes delivered inventory", () => {
  assert.match(atomic, /refund_commerce_order_payment/);
  assert.match(atomic, /stock_committed_at is not null and order_row\.stock_restored_at is null/);
  assert.match(atomic, /set stock = stock \+ line\.quantity/);
  assert.match(atomic, /delete from public\.commerce_inventory/);
  assert.match(atomic, /payment_status = 'refunded'/);
  assert.match(atomic, /stock_restored_at = case when restored then now\(\)/);
});

test("digital and avatar delivery is atomic and idempotent", () => {
  assert.match(atomic, /deliver_commerce_order_item/);
  assert.match(atomic, /where ci\.order_item_id = p_order_item_id[\s\S]*for update/);
  assert.match(atomic, /insert into public\.commerce_inventory/);
  assert.match(atomic, /insert into public\.clothing_items/);
  assert.match(atomic, /purchased_from_order_item_id/);
  assert.match(atomic, /delivery_status = 'delivered'/);
});

test("commerce Mercado Pago webhook delegates money transitions to locked RPCs", () => {
  assert.match(webhook, /verifyMercadoPagoSignature/);
  assert.match(webhook, /payment\.application_id/);
  assert.match(webhook, /payment\.collector_id/);
  assert.match(webhook, /transaction_amount/);
  assert.match(webhook, /currency_id/);
  assert.match(webhook, /confirm_commerce_order_payment/);
  assert.match(webhook, /refund_commerce_order_payment/);
  assert.match(webhook, /deliver_commerce_order_item/);
  assert.doesNotMatch(webhook, /decrement_commerce_product_stock/);
  assert.doesNotMatch(webhook, /Best-effort stock decrement/);
});
