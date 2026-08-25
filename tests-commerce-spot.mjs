import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildClouvaBarcodeValue,
  buildClouvaQrUrl,
  buildSpotSku,
  detectCommerceIdentifierType,
  isValidGtin,
  normalizeCommerceIdentifier,
  validateCommerceIdentifier,
} from "./lib/commerce/identifiers.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("./supabase/migrations/20260823034424_iglu_commerce_scanner_flow.sql");
const scanner = read("./components/commerce/SpotCommerceDashboard.tsx");
const checkout = read("./app/api/commerce/checkout/route.ts");
const webhook = read("./app/api/webhooks/mercadopago/commerce-orders/route.ts");
const fx = read("./lib/server/commerce-fx.ts");

test("commercial identifiers normalize and validate without changing the canonical product", () => {
  assert.equal(normalizeCommerceIdentifier("  iglu-ocb 01 "), "IGLUOCB01");
  assert.equal(detectCommerceIdentifierType("4006381333931"), "ean_13");
  assert.equal(isValidGtin("4006381333931"), true);
  assert.equal(validateCommerceIdentifier("ean_13", "4006381333932").valid, false);
  assert.equal(detectCommerceIdentifierType("https://clouva.com.ar/q/example"), "clouva_qr");
});

test("CLOUVA-owned codes are deterministic in format and route to authenticity pages", () => {
  assert.equal(buildSpotSku({ spotSlug: "el-iglu", productName: "Remera física", color: "Negro", size: "M", suffix: "A1" }), "ELIG-RF-NEGR-M-A1");
  assert.match(buildClouvaBarcodeValue("abc-123"), /^CLV[A-Z0-9]{18}$/);
  assert.equal(buildClouvaQrUrl("https://clouva.com.ar/", "abc-123"), "https://clouva.com.ar/q/abc-123");
});

test("Spot extends the canonical commerce model and never creates a parallel legacy shop", () => {
  assert.match(migration, /alter table public\.commerce_products/);
  assert.match(migration, /create table if not exists public\.commerce_catalog_products/);
  assert.match(migration, /create table if not exists public\.commerce_spots/);
  assert.doesNotMatch(migration, /create table(?: if not exists)? public\.products\b/);
  assert.doesNotMatch(migration, /create table(?: if not exists)? public\.orders\b/);
});

test("global identifiers resolve into one catalog identity and a Spot listing", () => {
  assert.match(migration, /commerce_product_identifiers_global_code_unique/);
  assert.match(migration, /resolve_commerce_identifier/);
  assert.match(migration, /listing\.spot_id = p_spot_id/);
  assert.match(migration, /upsert_commerce_scanned_product/);
  assert.match(migration, /catalog_product_id = v_catalog\.id/);
});

test("inventory, FX and Flow facts are append-only and idempotent", () => {
  assert.match(migration, /commerce_inventory_movements_idempotency_unique/);
  assert.match(migration, /commerce_fx_rates_idempotency_unique/);
  assert.match(migration, /commerce_flow_ledger_idempotency_unique/);
  assert.match(migration, /commerce_inventory_movements_immutable/);
  assert.match(migration, /commerce_fx_rates_immutable/);
  assert.match(migration, /commerce_flow_ledger_immutable/);
  assert.match(migration, /commerce_flow_ledger_flow_equals_usd check \(flows_amount = net_usd\)/);
});

test("the official FX snapshot is recorded before each Spot payment", () => {
  assert.match(fx, /api\.bcra\.gob\.ar\/estadisticascambiarias\/v1\.0\/Cotizaciones\/USD/);
  assert.match(fx, /record_commerce_fx_rate/);
  assert.match(webhook, /latestOrRefreshSpotFxRate/);
  assert.match(webhook, /record_commerce_spot_payment/);
});

test("physical plus 3D bundles expand atomically before stock and delivery", () => {
  assert.match(migration, /configure_commerce_listing_bundle/);
  assert.match(migration, /expand_commerce_bundle_order_items/);
  assert.match(migration, /bundle_parent_item_id/);
  assert.match(migration, /component_role in \('physical', 'digital'\)/);
  assert.match(webhook, /expand_commerce_bundle_order_items[\s\S]*confirm_commerce_order_payment/);
  assert.match(webhook, /record_commerce_order_stock_movements/);
  assert.match(checkout, /component_role === "physical"/);
  assert.match(checkout, /component_role === "digital"/);
});

test("the scanner supports rear camera, torch, browser fallback and manual entry", () => {
  assert.match(scanner, /facingMode: \{ ideal: "environment" \}/);
  assert.match(scanner, /BarcodeDetector/);
  assert.match(scanner, /BrowserMultiFormatReader/);
  assert.match(scanner, /capabilities\.torch/);
  assert.match(scanner, /Ingreso manual/);
  assert.match(scanner, /Configurar físico \+ 3D/);
});

test("the Spot dashboard exposes real operating actions and no dead AI placeholder", () => {
  assert.match(scanner, /Centro operativo/);
  assert.match(scanner, /Todo listo para la primera venta/);
  assert.match(scanner, /Nueva venta/);
  assert.match(scanner, /Escanear producto/);
  assert.match(scanner, /Cargar stock/);
  assert.match(scanner, /Crear etiquetas/);
  assert.match(scanner, /href="\/clouva-ai"/);
  assert.doesNotMatch(scanner, /Próximamente/);
});

test("the Spot header reuses the authenticated account menu and prefers the username", () => {
  assert.match(scanner, /<AccountMenu preferUsername\s*\/>/);
  assert.doesNotMatch(scanner, />Sergio</);
});

test("operational ledgers remain manager-readable and service-role writable", () => {
  assert.match(migration, /alter table public\.commerce_flow_ledger enable row level security/);
  assert.match(migration, /commerce_flow_ledger_manager_select/);
  assert.match(migration, /revoke all on public\.commerce_flow_ledger from anon, authenticated/);
  assert.match(migration, /grant execute on function public\.complete_commerce_pos_sale[\s\S]*to service_role/);
});
