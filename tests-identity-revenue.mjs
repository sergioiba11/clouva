import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("Instagram remains an external server-side connection, not a Supabase auth provider", () => {
  const login = read("./app/login/login-content.tsx");
  const connect = read("./app/api/integrations/instagram/connect/route.ts");
  const callback = read("./app/api/integrations/instagram/callback/route.ts");
  const config = read("./core/integrations/instagram/config.ts");

  assert.doesNotMatch(login, /provider:\s*["']instagram["']/);
  assert.match(connect, /buildInstagramAuthorizeUrl/);
  assert.match(connect, /createInstagramState/);
  assert.match(callback, /consumeInstagramState/);
  assert.match(callback, /encryptSecret/);
  assert.match(config, /instagram_business_basic/);
});

test("Instagram OAuth state is hashed, expiring and single-use", () => {
  const source = read("./core/integrations/instagram/state.ts");
  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /state_hash:\s*sha256\(rawState\)/);
  assert.match(source, /continuation_hash:\s*rawContinuation\s*\?\s*sha256/);
  assert.match(source, /\.eq\("status",\s*"pending"\)/);
  assert.match(source, /\.gt\("expires_at",\s*now\)/);
  assert.match(source, /status:\s*"consumed"/);
});

test("Instagram import reuses the canonical Player instead of inserting a duplicate", () => {
  const source = read("./app/api/integrations/instagram/import/route.ts");
  const migration = read("./supabase/migrations/20260801002500_claim_existing_instagram_player.sql");

  assert.match(source, /from\("social_connections"\)/);
  assert.match(source, /connection\.external_username/);
  assert.match(source, /\.eq\("owner_user_id", userId\)/);
  assert.match(source, /\.ilike\("username", verifiedUsername\)/);
  assert.match(source, /\.rpc\("claim_existing_instagram_player"/);
  assert.match(source, /const slug = \(player\?\.slug/);
  assert.match(source, /const username = \(player\?\.username/);
  assert.match(source, /from\("players"\)\.update\(playerValues\)\.eq\("id", player\.id\)/);
  assert.match(source, /from\("players"\)\.insert\(/);
  assert.match(migration, /claim_existing_instagram_player/);
});

test("Mercado Pago activates VIP only after verified server-side payment", () => {
  const checkout = read("./app/api/billing/vip/checkout/route.ts");
  const webhook = read("./app/api/billing/mercadopago/webhook/route.ts");

  assert.match(checkout, /createMercadoPagoPreference/);
  assert.match(checkout, /external_reference/);
  assert.doesNotMatch(checkout, /\.update\(\{\s*is_vip:\s*true/);
  assert.match(webhook, /getMercadoPagoPayment/);
  assert.match(webhook, /payment\.status\s*!==\s*"approved"/);
  assert.match(webhook, /activate_vip_from_payment/);
});

test("Studio administration requires active Studio OS and an authorized internal role", () => {
  const permissions = read("./lib/server/studio-permissions.ts");
  const middleware = read("./middleware.ts");

  assert.match(permissions, /requireStudioManager/);
  assert.match(permissions, /studio_os_status/);
  assert.match(permissions, /studio_members/);
  assert.match(permissions, /owner|admin|manager/);
  assert.match(middleware, /studio-dashboard/);
});

test("Identity migrations are ordered before secure Studio claims", () => {
  const identity = read("./supabase/migrations/20260801002000_identity_foundation.sql");
  const claim = read("./supabase/migrations/20260801003000_secure_studio_claim.sql");

  assert.match(identity, /create table if not exists public\.social_connections/);
  assert.match(claim, /claim_studio/);
});

test("Next dynamic Studio API uses one segment name", () => {
  const source = read("./app/api/studios/[studioId]/route.ts");
  assert.match(source, /studioId/);
});
