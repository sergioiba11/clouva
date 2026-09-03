import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const eligibility = read("lib/server/purchase-eligibility.ts");
const checkoutApi = read("app/api/commerce/checkout/route.ts");
const purchaseApi = read("app/api/account/purchase-profile/route.ts");
const checkoutPage = read("app/checkout/page.tsx");
const migration = read("supabase/migrations/20260903154000_trusted_map_and_purchase_privacy.sql");
const publicPlayer = read("components/public/PlayerPublicView.tsx") + read("components/public/PlayerPublicLocationCard.tsx") + read("components/public/PlayerLocationMap.tsx");

test("adult eligibility is calculated from date of birth, never a stale numeric age", () => {
  assert.match(eligibility, /export function isAdult/);
  assert.match(eligibility, /age >= 18/);
  assert.match(eligibility, /date_of_birth/);
  assert.doesNotMatch(migration, /\bage\s+(?:integer|int|smallint|bigint)\b/i);
  assert.doesNotMatch(migration, /age_verified\s+boolean/i);
});

test("physical commerce checkout requires authenticated adult account and saved private address", () => {
  assert.match(checkoutApi, /requireUser\(request\)/);
  assert.match(checkoutApi, /requirePhysicalPurchaseEligibility\(admin, user\.id\)/);
  assert.match(eligibility, /PURCHASE_BIRTH_DATE_REQUIRED/);
  assert.match(eligibility, /PURCHASE_ADULT_REQUIRED/);
  assert.match(eligibility, /PURCHASE_ADDRESS_REQUIRED/);
  assert.match(checkoutPage, /Iniciar sesión para comprar/);
  assert.match(checkoutPage, /Necesitás tener 18 años o más/);
  assert.match(checkoutPage, /Dirección privada guardada/);
});

test("checkout snapshots server-loaded private address and ignores public Player locality", () => {
  assert.match(checkoutApi, /const savedAddress = eligibility\.defaultAddress/);
  assert.match(checkoutApi, /addressLine1: savedAddress\.address_line_1/);
  assert.match(checkoutApi, /city: savedAddress\.city/);
  assert.match(checkoutApi, /province: savedAddress\.province/);
  assert.doesNotMatch(checkoutApi, /player\.location|player\.latitude|player\.longitude/);
  assert.match(checkoutPage, /shipping: \{ methodId: selectedMethod\.id \}/);
  assert.doesNotMatch(checkoutPage, /addressLine1:\s*shipping|city:\s*shipping|province:\s*shipping/);
});

test("private purchase profile always scopes writes to authenticated user", () => {
  assert.match(purchaseApi, /requireUser\(request\)/);
  assert.match(purchaseApi, /user_id: user\.id/);
  assert.match(purchaseApi, /\.eq\(["']user_id["'], user\.id\)/);
  assert.doesNotMatch(purchaseApi, /body\.userId|source\.userId/);
});

test("address ownership is verified before clearing the current default", () => {
  const ownershipCheck = purchaseApi.indexOf('.select("id")');
  const clearDefault = purchaseApi.indexOf('.update({ is_default: false');
  assert.ok(ownershipCheck >= 0, "missing private address ownership lookup");
  assert.ok(clearDefault > ownershipCheck, "default address must not be cleared before ownership validation");
  assert.match(purchaseApi, /La dirección no pertenece a tu cuenta/);
});

test("DOB and delivery addresses have strict owner-only RLS", () => {
  assert.match(migration, /alter table public\.account_private_data enable row level security/);
  assert.match(migration, /alter table public\.user_addresses enable row level security/);
  assert.match(migration, /create policy account_private_data_own/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /create policy user_addresses_own/);
  assert.match(migration, /with check \(user_id = auth\.uid\(\)\)/);
});

test("private purchase data never enters public Player rendering", () => {
  assert.doesNotMatch(publicPlayer, /account_private_data|user_addresses|date_of_birth|address_line_1|recipient_phone/);
  assert.doesNotMatch(publicPlayer, /trusted_map_locations/);
});

test("checkout UI sends only cart identity and delivery method, not the private street address", () => {
  assert.match(checkoutPage, /authenticatedFetch\(["']\/api\/commerce\/checkout["']/);
  assert.match(checkoutPage, /items: items\.map/);
  assert.match(checkoutPage, /shipping: \{ methodId: selectedMethod\.id \}/);
  assert.doesNotMatch(checkoutPage, /body:\s*JSON\.stringify\([\s\S]*address_line_1/);
});
