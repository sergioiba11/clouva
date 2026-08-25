import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  spotRoleAllows,
  SPOT_ROLES,
} from "./lib/commerce/spot-permissions.ts";
import {
  sanitizeSpotBusinessAnalysis,
} from "./lib/commerce/spot-business.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("roles de MI SPOT aplican capacidades mínimas server-side", () => {
  assert.deepEqual(SPOT_ROLES, ["owner", "admin", "manager", "catalog", "inventory", "sales", "finance", "content", "support", "viewer"]);
  assert.equal(spotRoleAllows("owner", "finance"), true);
  assert.equal(spotRoleAllows("owner", "transfer_owner"), true);
  assert.equal(spotRoleAllows("admin", "finance"), true);
  assert.equal(spotRoleAllows("admin", "transfer_owner"), false);
  assert.equal(spotRoleAllows("catalog", "catalog"), true);
  assert.equal(spotRoleAllows("catalog", "finance"), false);
  assert.equal(spotRoleAllows("finance", "finance"), true);
  assert.equal(spotRoleAllows("finance", "inventory"), false);
  assert.equal(spotRoleAllows("inventory", "inventory"), true);
  assert.equal(spotRoleAllows("inventory", "finance"), false);
  assert.equal(spotRoleAllows("viewer", "view"), true);
  assert.equal(spotRoleAllows("viewer", "operations"), false);
});

test("migración universal conserva Spots de Studio y permite propietario user durante la transición", () => {
  const migration = read("./supabase/migrations/20260823194000_universal_commerce_spots.sql");
  assert.match(migration, /alter column studio_id drop not null/i);
  assert.match(migration, /owner_type in \('user', 'studio'\)/);
  assert.match(migration, /owner_type = 'user' and owner_user_id is not null and studio_id is null/);
  assert.match(migration, /owner_type = 'studio' and studio_id is not null and owner_user_id is null/);
  assert.match(migration, /set owner_type = 'studio'[\s\S]*studio_id is not null/);
  assert.match(migration, /create table if not exists public\.commerce_spot_members/);
  assert.match(migration, /'owner', 'admin', 'manager', 'catalog', 'inventory', 'sales'/);
  assert.match(migration, /create_user_commerce_spot/);
  assert.match(migration, /insert into public\.commerce_inventory_locations/);
  assert.match(migration, /insert into public\.commerce_flow_accounts/);
});

test("Space Core proyecta legacy Studio/Spot sin duplicar Commerce", () => {
  const migration = read("./supabase/migrations/20260825004237_player_spaces_commerce_miflow_normalization.sql");
  assert.match(migration, /create table if not exists public\.spaces/);
  assert.match(migration, /legacy_studio_id/);
  assert.match(migration, /legacy_commerce_spot_id/);
  assert.match(migration, /owner_player_id/);
  assert.match(migration, /create table if not exists public\.space_members/);
  assert.match(migration, /type in \('studio','business','spot','club','brand','other'\)/);
  assert.doesNotMatch(migration, /drop table public\.(studios|commerce_spots)/i);
});

test("Spot del Player reutiliza productos, órdenes y ledger con identidad económica Player", () => {
  const legacy = read("./supabase/migrations/20260823194000_universal_commerce_spots.sql");
  const canonical = read("./supabase/migrations/20260825004237_player_spaces_commerce_miflow_normalization.sql");
  assert.match(legacy, /commerce_products_owner_user_id_fkey/);
  assert.match(legacy, /owner_type in \('player', 'studio', 'user', 'clouva'\)/);
  assert.match(legacy, /commerce_orders_seller_user_id_fkey/);
  assert.match(legacy, /seller_type in \('player', 'studio', 'user', 'clouva'\)/);
  assert.match(canonical, /normalize_commerce_listing_spot_owner/);
  assert.match(canonical, /new\.owner_type := 'player'/);
  assert.match(canonical, /normalize_commerce_order_spot_seller/);
  assert.match(canonical, /new\.seller_type := 'player'/);
  assert.match(canonical, /beneficiary_type/);
  assert.doesNotMatch(canonical, /buyer_id[^\n]*beneficiary/i);
});

test("manager administra pero no se transforma en beneficiario económico", () => {
  const migration = read("./supabase/migrations/20260823194000_universal_commerce_spots.sql");
  const summary = read("./app/api/mi-flow/summary/route.ts");
  assert.match(migration, /v_spot\.beneficiary_user_id/);
  assert.match(migration, /new\.seller_user_id/);
  assert.doesNotMatch(migration, /commerce_spot_members[^;]*beneficiary_user_id/is);
  assert.match(summary, /FINANCE_ROLES/);
  assert.match(summary, /rowBelongsToSpace/);
  assert.match(summary, /personalBreakdown/);
  assert.match(summary, /if \(!personalBreakdown\) managedRows\.push/);
});

test("Gemini configura el negocio con JSON validado y sin autoridad económica", () => {
  const analyzer = read("./lib/server/spot-business-analysis.ts");
  const route = read("./app/api/mi-spot/analyze/route.ts");
  assert.match(analyzer, /import "server-only"/);
  assert.match(analyzer, /process\.env\.GEMINI_API_KEY/);
  assert.match(analyzer, /responseJsonSchema: RESPONSE_SCHEMA/);
  assert.match(analyzer, /No generes precios, saldos, pagos, permisos, propietarios ni datos financieros/);
  assert.match(route, /await requireUser\(request\)/);
  assert.match(route, /advisoryOnly: true/);
  assert.doesNotMatch(route, /\.from\("commerce_spots"\)\.insert/);
  assert.doesNotMatch(route, /mi_flow_money_ledger/);
});

test("sanitizador de Gemini elimina módulos fuera del Core permitido", () => {
  const analysis = sanitizeSpotBusinessAnalysis({
    businessType: "barber_shop",
    businessCategories: ["barbería", "cuidado"],
    suggestedModules: ["services", "bookings", "products", "inventory", "hacker_admin"],
    suggestedInventoryMode: "variants",
    suggestedSalesChannels: ["local", "online"],
    suggestedBrandTone: "sobrio",
    suggestedDescription: "Barbería con productos.",
  });
  assert.equal(analysis.businessType, "barber_shop");
  assert.deepEqual(analysis.suggestedModules, ["services", "bookings", "products", "inventory"]);
  assert.equal(analysis.suggestedModules.includes("hacker_admin"), false);
  assert.equal(analysis.suggestedInventoryMode, "variants");
});

test("crear un espacio usa Player universal, exige VIP para administrar y no obliga a crear un Studio", () => {
  const route = read("./app/api/mi-spot/route.ts");
  const onboarding = read("./app/mi-spot/new/page.tsx");
  const canonical = read("./supabase/migrations/20260825004237_player_spaces_commerce_miflow_normalization.sql");
  const access = read("./lib/server/space-access.ts");
  assert.match(route, /p_owner_user_id: user\.id/);
  assert.match(route, /create_user_commerce_spot/);
  assert.match(route, /requireSpaceAdminPlan/);
  assert.match(canonical, /ensure_player_for_user/);
  assert.match(canonical, /VIP_REQUIRED/);
  assert.match(access, /CLOUVA VIP es necesario para crear y administrar espacios/);
  assert.match(onboarding, /Tu Player es la identidad propietaria dentro de CLOUVA/);
  assert.match(onboarding, /CLOUVA VIP/);
  assert.doesNotMatch(route, /\.from\("studios"\)\.insert/);
});

test("producto canónico se publica en múltiples targets sin copiar stock ni precio", () => {
  const migration = read("./supabase/migrations/20260825004237_player_spaces_commerce_miflow_normalization.sql");
  const api = read("./app/api/commerce/products/[productId]/publications/route.ts");
  const controls = read("./components/commerce/ProductPublicationControls.tsx");
  assert.match(migration, /create table if not exists public\.commerce_product_publications/);
  assert.match(migration, /product_id uuid not null references public\.commerce_products/);
  assert.match(migration, /target_type text not null check \(target_type in \('player','space','marketplace'\)\)/);
  assert.doesNotMatch(migration, /commerce_product_publications[\s\S]{0,500}(stock|price)/i);
  assert.match(api, /commerce_product_publications/);
  assert.match(controls, /Mostrar en mi Player/);
  assert.match(controls, /Mostrar en este espacio/);
});
