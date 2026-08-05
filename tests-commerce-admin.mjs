import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const operations = read("./supabase/migrations/20260805233000_commerce_admin_operations.sql");
const audit = read("./supabase/migrations/20260805233100_commerce_admin_audit_wrappers.sql");
const adminApi = read("./app/api/admin/commerce/orders/[id]/route.ts");
const adminPage = read("./app/admin/marketplace/page.tsx");

test("stock conflicts are resolved by re-locking and revalidating inventory", () => {
  assert.match(operations, /resolve_commerce_stock_conflict/);
  assert.match(operations, /from public\.commerce_orders[\s\S]*for update/);
  assert.match(operations, /from public\.commerce_product_variants[\s\S]*for update/);
  assert.match(operations, /Stock insuficiente para la variante/);
  assert.match(operations, /set stock = stock - line\.quantity/);
  assert.match(operations, /stock_committed_at = now\(\)/);
  assert.match(operations, /stock_conflict_resolved/);
});

test("manual fulfillment cannot mutate payment status", () => {
  assert.match(operations, /admin_update_commerce_fulfillment/);
  assert.match(operations, /Solo una orden pagada puede avanzar/);
  assert.match(operations, /Resolvé el conflicto de stock antes de preparar/);
  assert.match(operations, /tracking_number/);
  assert.match(operations, /shipped_at/);
  assert.match(operations, /delivered_at/);
  assert.doesNotMatch(operations, /set payment_status/);
  assert.doesNotMatch(adminApi, /paymentStatus/);
  assert.doesNotMatch(adminApi, /payment_status/);
});

test("every manual commerce operation is wrapped in an atomic audit entry", () => {
  assert.match(audit, /admin_resolve_commerce_stock_conflict/);
  assert.match(audit, /admin_set_commerce_fulfillment/);
  assert.match(audit, /insert into public\.admin_audit_log/);
  assert.match(audit, /previous_data/);
  assert.match(audit, /new_data/);
  assert.match(adminApi, /admin_resolve_commerce_stock_conflict/);
  assert.match(adminApi, /admin_set_commerce_fulfillment/);
});

test("commerce admin exposes operational details and stock conflict action", () => {
  assert.match(adminPage, /from\("commerce_order_items"\)/);
  assert.match(adminPage, /from\("commerce_shipments"\)/);
  assert.match(adminPage, /from\("commerce_order_events"\)/);
  assert.match(adminPage, /resolve_stock_conflict/);
  assert.match(adminPage, /update_fulfillment/);
  assert.match(adminPage, /trackingNumber/);
  assert.match(adminPage, /variantCopy\(item\)/);
  assert.match(adminPage, /payment_status === "paid"/);
});

test("admin can configure CLOUVA shipping without inventing a default rate", () => {
  assert.match(adminPage, /from\("commerce_shipping_methods"\)/);
  assert.match(adminPage, /owner_type: "clouva"/);
  assert.match(adminPage, /pricingType: "flat" \| "free"/);
  assert.match(adminPage, /deliveryMethod: "shipping" \| "pickup"/);
  assert.match(adminPage, /toggleShippingMethod/);
  assert.doesNotMatch(adminPage, /defaultShipping/);
});

test("revenue metrics count only payments that remain paid", () => {
  assert.match(adminPage, /order\.payment_status === "paid" && !order\.refunded_at/);
  assert.match(adminPage, /const gmv = paidOrders\.reduce/);
  assert.match(adminPage, /const commissions = paidOrders\.reduce/);
});
