import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("Instagram remains an external server-side connection, not a Supabase auth provider", () => {
  const login = read("./app/login/login-content.tsx");
  const callback = read("./app/api/integrations/instagram/callback/route.ts");
  const config = read("./core/integrations/instagram/config.ts");

  assert.doesNotMatch(login, /provider:\s*["']instagram["']/);
  assert.match(login, /\/api\/integrations\/instagram\/connect/);
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

test("Instagram import reuses the existing Player and reports registered usernames clearly", () => {
  const source = read("./app/api/integrations/instagram/import/route.ts");
  const migration = read("./supabase/migrations/20260801002500_claim_existing_instagram_player.sql");

  assert.match(source, /\.eq\("owner_user_id", user\.id\)/);
  assert.match(source, /\.ilike\("username", requestedProfile\.username\)/);
  assert.match(source, /\.rpc\(\s*"claim_existing_instagram_player"/);
  assert.match(source, /from\("players"\)\.update\(playerValues\)\.eq\("id", player\.id\)/);
  assert.match(source, /onConflict: "player_id,user_id"/);
  assert.match(source, /Este usuario ya está registrado\./);
  assert.match(migration, /for update/);
  assert.match(migration, /delete from public\.players/);
  assert.match(migration, /grant execute on function public\.claim_existing_instagram_player\(uuid, uuid\) to service_role/);
});

test("Mercado Pago activates VIP only after verified server-side payment", () => {
  const webhook = read("./core/billing/webhook.ts");
  const service = read("./core/billing/service.ts");
  const signature = read("./core/billing/providers/mercadopago/signature.ts");

  assert.match(webhook, /verifyMercadoPagoSignature/);
  assert.match(webhook, /processApprovedPayment/);
  assert.match(webhook, /billing_webhook_events/);
  assert.match(service, /payment\.application_id/);
  assert.match(service, /payment\.collector_id/);
  assert.match(service, /transaction_amount/);
  assert.match(service, /currency_id/);
  assert.match(service, /duplicate_payment/);
  assert.match(service, /activateEntitlement/);
  assert.match(signature, /timingSafeEqual/);
});

test("Studio administration requires both active VIP and an authorized role", () => {
  const migration = read("./supabase/migrations/20260729212900_can_manage_studio_vip.sql");
  const permissions = read("./lib/server/studio-permissions.ts");

  assert.match(migration, /ue\.tier = 'vip'/);
  assert.match(migration, /ue\.status = 'active'/);
  assert.match(migration, /sm\.role in \('owner', 'admin', 'manager', 'editor'\)/);
  assert.match(permissions, /user_entitlements/);
  assert.match(permissions, /studio_members/);
});

test("Identity migrations are ordered before secure Studio claims", () => {
  const files = fs.readdirSync(new URL("./supabase/migrations/", import.meta.url)).sort();
  const core = files.indexOf("20260729213000_identity_revenue_v2.sql");
  const repairs = files.indexOf("20260729213050_identity_revenue_v2_schema_repairs.sql");
  const claims = files.indexOf("20260729213500_claim_studio_access.sql");
  assert.notEqual(core, -1);
  assert.notEqual(repairs, -1);
  assert.notEqual(claims, -1);
  assert.ok(core < repairs && repairs < claims, "schema repairs must run before claim functions");
});

test("Next dynamic Studio API uses one segment name", () => {
  assert.ok(fs.existsSync(new URL("./app/api/studios/[slug]/applications/route.ts", import.meta.url)));
  assert.ok(fs.existsSync(new URL("./app/api/studios/[slug]/dashboard/route.ts", import.meta.url)));
  assert.equal(fs.existsSync(new URL("./app/api/studios/[studioId]/dashboard/route.ts", import.meta.url)), false);
});
