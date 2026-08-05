import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const foundation = read("./supabase/migrations/20260805230000_commerce_physical_foundation.sql");
const atomic = read("./supabase/migrations/20260805231000_commerce_atomic_payment.sql");
const uniqueness = read("./supabase/migrations/20260805231100_commerce_order_item_uniqueness.sql");
const shippingSchema = read("./supabase/migrations/20260805232000_commerce_shipping_methods.sql");
const shippingService = read("./core/commerce/shipping/service.ts");
const checkout = read("./app/api/commerce/checkout/route.ts");
const webhook = read("./app/api/webhooks/mercadopago/commerce-orders/route.ts");
const storefront = read("./app/tienda/page.tsx");
const catalog = read("./app/catalogo/page.tsx");
const productPage = read("./app/producto/[slug]/page.tsx");
const cartStore = read("./lib/cart-store.ts");
const addToCart = read("./components/store/add-to-cart.tsx");
const checkoutPage = read("./app/checkout/page.tsx");

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

test("checkout consolidates and validates exact product variants", () => {
  assert.match(checkout, /type CartItemInput = \{ productId\?: unknown; variantId\?: unknown; quantity\?: unknown \}/);
  assert.match(checkout, /const lines = new Map<string, RequestedLine>\(\)/);
  assert.match(checkout, /lineKey\(productId, variantId\)/);
  assert.match(checkout, /from\("commerce_product_variants"\)/);
  assert.match(checkout, /selectedVariant\?\.price_override \?\? product\.price/);
  assert.match(checkout, /variant_id: selectedVariant\?\.id \?\? null/);
  assert.match(checkout, /sku_snapshot: selectedVariant\?\.sku \?\? null/);
  assert.match(checkout, /variant_snapshot: variantSnapshot/);
  assert.match(checkout, /\.select\("id,checkout_token"\)/);
  assert.match(checkout, /source=commerce&token=/);
});

test("official storefront reads only published CLOUVA physical commerce products", () => {
  for (const source of [storefront, catalog, productPage]) {
    assert.match(source, /from\("commerce_products"\)/);
    assert.match(source, /\.eq\("owner_type", "clouva"\)/);
    assert.match(source, /\.eq\("product_type", "physical"\)/);
    assert.match(source, /\.eq\("status", "published"\)/);
    assert.doesNotMatch(source, /from\("products"\)/);
  }
});

test("cart lines cannot merge different sizes or colors", () => {
  assert.match(cartStore, /lineId\(productId: string, variantId: string \| null\)/);
  assert.match(cartStore, /`\$\{productId\}:\$\{variantId \?\? "base"\}`/);
  assert.match(cartStore, /variantId: string \| null/);
  assert.match(addToCart, /variantId: selectedVariant\?\.id \?\? null/);
  assert.match(addToCart, /size: selectedVariant\?\.size/);
  assert.match(addToCart, /color: selectedVariant\?\.color/);
});

test("visible checkout sends canonical variant identifiers", () => {
  assert.match(checkoutPage, /fetch\("\/api\/commerce\/checkout"/);
  assert.match(checkoutPage, /authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(checkoutPage, /productId: item\.productId/);
  assert.match(checkoutPage, /variantId: item\.variantId/);
  assert.doesNotMatch(checkoutPage, /fetch\("\/api\/checkout"/);
});

test("shipping methods are seller-owned and transport-independent", () => {
  assert.match(shippingSchema, /create table if not exists public\.commerce_shipping_methods/);
  assert.match(shippingSchema, /owner_type text not null check \(owner_type in \('player', 'studio', 'clouva'\)\)/);
  assert.match(shippingSchema, /delivery_method in \('shipping', 'pickup'\)/);
  assert.match(shippingSchema, /pricing_type in \('flat', 'free', 'adapter'\)/);
  assert.match(shippingSchema, /adapter_key text/);
  assert.match(shippingSchema, /shipping_method_snapshot jsonb/);
  assert.match(shippingService, /interface CommerceShippingAdapter/);
  assert.match(shippingService, /registerCommerceShippingAdapter/);
  assert.match(shippingService, /quoteCommerceShipping/);
  assert.match(shippingService, /method\.pricing_type === "flat"/);
  assert.match(shippingService, /method\.pricing_type === "free"/);
});

test("checkout calculates shipping on the server and includes it in Mercado Pago total", () => {
  assert.match(checkout, /from\("commerce_shipping_methods"\)/);
  assert.match(checkout, /shippingMethodMatchesSeller/);
  assert.match(checkout, /quoteCommerceShipping\(method, address/);
  assert.match(checkout, /shippingSubtotal = quote\.price/);
  assert.match(checkout, /title: `Entrega — \$\{method\.name\}`/);
  assert.match(checkout, /const total = subtotal \+ shippingSubtotal/);
  assert.match(checkout, /shipping_subtotal: shippingSubtotal/);
  assert.match(checkout, /from\("commerce_shipments"\)\.insert/);
  assert.match(checkout, /shipping_method_snapshot/);
});

test("visible checkout captures a structured address and pickup alternative", () => {
  assert.match(checkoutPage, /from\("commerce_shipping_methods"\)/);
  assert.match(checkoutPage, /recipientName/);
  assert.match(checkoutPage, /addressLine1/);
  assert.match(checkoutPage, /addressLine2/);
  assert.match(checkoutPage, /postalCode/);
  assert.match(checkoutPage, /selectedMethod\?\.delivery_method === "shipping"/);
  assert.match(checkoutPage, /shipping,/);
  assert.doesNotMatch(checkoutPage, /address:\s*""/);
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
