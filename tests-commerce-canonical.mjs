import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const foundation = read("./supabase/migrations/20260805230000_commerce_physical_foundation.sql");

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
