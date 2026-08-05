import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const preflight = read("./supabase/migrations/20260805233900_commerce_legacy_import_preflight.sql");
const compatibility = read("./supabase/migrations/20260805234000_commerce_legacy_compatibility.sql");
const postflight = read("./supabase/migrations/20260805234100_commerce_legacy_import_postflight.sql");
const auditWrapper = read("./supabase/migrations/20260805234200_commerce_legacy_admin_wrapper.sql");
const api = read("./app/api/admin/commerce/legacy-migrate/route.ts");
const page = read("./app/admin/marketplace/compatibilidad/page.tsx");

test("legacy compatibility never deletes the original store", () => {
  assert.doesNotMatch(compatibility, /drop table public\.(products|orders|order_items|product_variants)/i);
  assert.doesNotMatch(compatibility, /delete from public\.(products|orders|order_items|product_variants)/i);
  assert.match(compatibility, /Legacy tables remain untouched/);
});

test("every imported entity is linked idempotently to its source UUID", () => {
  assert.match(compatibility, /create table if not exists public\.commerce_legacy_links/);
  assert.match(compatibility, /unique \(legacy_entity_type, legacy_id\)/);
  assert.match(compatibility, /where not exists \([\s\S]*legacy_entity_type = 'product'/);
  assert.match(compatibility, /where not exists \([\s\S]*legacy_entity_type = 'order'/);
  assert.match(compatibility, /migrate_legacy_store_to_commerce/);
});

test("legacy IDs and provider references are preserved as metadata rather than reused as live payment keys", () => {
  assert.match(compatibility, /add column if not exists metadata jsonb/);
  assert.match(compatibility, /'source_table', 'products'/);
  assert.match(compatibility, /'source_table', 'orders'/);
  assert.match(compatibility, /'external_reference', order_json ->> 'external_reference'/);
  assert.match(compatibility, /'external_payment_id', order_json ->> 'external_payment_id'/);
  assert.doesNotMatch(compatibility, /external_reference,\s*external_payment_id,\s*created_at/);
});

test("unknown historical buyers are surfaced and never fabricated", () => {
  assert.match(compatibility, /commerce_legacy_import_issues/);
  assert.match(compatibility, /missing_auth_buyer/);
  assert.match(compatibility, /not exists \(select 1 from auth\.users/);
  assert.match(compatibility, /continue;/);
  assert.doesNotMatch(compatibility, /auth\.users\s*\(/);
});

test("legacy stock ambiguity creates one base variant instead of inventing size distribution", () => {
  assert.match(compatibility, /if variant_count = 0 then/);
  assert.match(compatibility, /'Edición base'/);
  assert.match(compatibility, /no_variant_stock_distribution_available/);
  assert.match(preflight, /legacy_original_sku/);
});

test("repeated legacy order lines are normalized before restoring the canonical unique index", () => {
  assert.match(preflight, /drop index if exists public\.commerce_order_items_order_product_variant_unique/);
  assert.match(postflight, /commerce_legacy_item_merge/);
  assert.match(postflight, /sum\(quantity\)/);
  assert.match(postflight, /merged_into_commerce_order_item_id/);
  assert.match(postflight, /create unique index if not exists commerce_order_items_order_product_variant_unique/);
});

test("manual compatibility runs are admin-only and audited", () => {
  assert.match(auditWrapper, /admin_migrate_legacy_store_to_commerce/);
  assert.match(auditWrapper, /insert into public\.admin_audit_log/);
  assert.match(api, /requireAdmin/);
  assert.match(api, /admin_migrate_legacy_store_to_commerce/);
  assert.match(page, /\/api\/admin\/commerce\/legacy-migrate/);
  assert.match(page, /Buscar y vincular datos clásicos/);
});

test("compatibility metadata and unresolved issues are protected by admin RLS", () => {
  assert.match(postflight, /alter table public\.commerce_legacy_links enable row level security/);
  assert.match(postflight, /alter table public\.commerce_legacy_import_issues enable row level security/);
  assert.match(postflight, /profile\.role = 'admin'/);
  assert.match(postflight, /revoke all on public\.commerce_legacy_compatibility_status from anon, authenticated/);
});
