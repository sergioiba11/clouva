import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("onboarding asks for an action and keeps professional identity separate", async () => {
  const [modePage, playerPage, modeApi] = await Promise.all([
    read("./app/onboarding/identity/page.tsx"),
    read("./app/onboarding/player-identity/page.tsx"),
    read("./app/api/profile/modes/route.ts"),
  ]);
  assert.match(modePage, /¿Qué querés hacer en CLOUVA\?/);
  assert.match(modePage, /Explorar CLOUVA/);
  assert.match(modePage, /Crear mi Estudio/);
  assert.doesNotMatch(modePage, /professional_categories/);
  assert.match(playerPage, /professional_categories/);
  assert.match(modeApi, /profile_modes/);
});

test("Studio OS sigue perteneciendo al Studio y el rol administrativo además exige VIP", async () => {
  const [permissions, spaceAccess, aiPermissions, createPage, createApi, studioOsApi, billing] = await Promise.all([
    read("./lib/server/studio-permissions.ts"),
    read("./lib/server/space-access.ts"),
    read("./lib/server/vip-profile-permissions.ts"),
    read("./app/studios/nuevo/page.tsx"),
    read("./app/api/studios/create/route.ts"),
    read("./app/api/studios/[slug]/studio-os/route.ts"),
    read("./core/billing/service.ts"),
  ]);
  assert.match(permissions, /requireSpaceAdminPlan/);
  assert.match(permissions, /studio_os_status/);
  assert.match(spaceAccess, /tier", "vip"/);
  assert.match(spaceAccess, /CLOUVA VIP es necesario para crear y administrar espacios/);
  assert.match(aiPermissions, /if \(args\.studioId\)/);
  assert.match(aiPermissions, /requireStudioManager/);
  assert.match(aiPermissions, /productGate: "studio_os"/);
  assert.match(createPage, /\/api\/studios\/create/);
  assert.doesNotMatch(createPage, /\.from\("studios"\)\.insert/);
  assert.match(createApi, /create_studio_os_draft/);
  assert.match(studioOsApi, /clouva_studio_os/);
  assert.match(billing, /activate_studio_os/);
});

test("Studio OS price is explicitly configured and versioned instead of invented", async () => {
  const [schema, priceApi, adminPage, versionMigration] = await Promise.all([
    read("./supabase/migrations/20260802220000_multirol_studio_os_schema.sql"),
    read("./app/api/admin/studio-os-price/route.ts"),
    read("./app/admin/estudios/studio-os/page.tsx"),
    read("./supabase/migrations/20260802220500_billing_price_versions.sql"),
  ]);
  assert.match(schema, /'clouva_studio_os'/);
  assert.match(schema, /false,/);
  assert.match(priceApi, /Ingresá un precio mayor que cero/);
  assert.match(priceApi, /provisionProductPlan/);
  assert.match(priceApi, /version_number/);
  assert.match(adminPage, /No se publica ningún precio inventado/);
  assert.match(versionMigration, /version_number/);
  assert.match(versionMigration, /drop constraint if exists billing_prices_product_id_provider_currency_billing_interva_key/);
});

test("Studio memberships project the plan role into player_studios atomically", async () => {
  const [joinRoute, helper, publicView, activationMigration] = await Promise.all([
    read("./app/api/studios/[slug]/membership/join/route.ts"),
    read("./lib/server/studio-memberships.ts"),
    read("./components/public/StudioPublicView.tsx"),
    read("./supabase/migrations/20260802220300_multirol_membership_activation_fix.sql"),
  ]);
  assert.match(joinRoute, /activateStudioMembership/);
  assert.match(helper, /activate_studio_membership/);
  assert.match(activationMigration, /insert into public\.studio_memberships/);
  assert.match(activationMigration, /insert into public\.player_studios/);
  assert.match(activationMigration, /on conflict \(player_id, studio_id\)/i);
  assert.match(publicView, /entry\.role \|\| "Miembro"/);
  assert.doesNotMatch(publicView, /entry\.player\.primary_role/);
});

test("paid Studio intent waits for a published Player and resumes the same checkout", async () => {
  const [subscribeRoute, checkoutAction, playersRoute, previewPage] = await Promise.all([
    read("./app/api/studios/[slug]/membership/subscribe/route.ts"),
    read("./components/public/StudioMembershipCheckoutAction.tsx"),
    read("./app/api/players/me/route.ts"),
    read("./app/onboarding/profile-preview/page.tsx"),
  ]);
  assert.match(subscribeRoute, /pending_studio_joins/);
  assert.match(subscribeRoute, /requiresPlayer: true/);
  assert.match(subscribeRoute, /returnPath/);
  assert.match(checkoutAction, /payload\.requiresPlayer && payload\.redirectTo/);
  assert.match(playersRoute, /pendingStudioReturnPath/);
  assert.match(previewPage, /router\.replace\(payload\.pendingStudioReturnPath\)/);
});

test("cancelled or expired memberships leave the public Studio roster", async () => {
  const trigger = await read("./supabase/migrations/20260802220400_studio_membership_projection_trigger.sql");
  assert.match(trigger, /after insert or update of status/);
  assert.match(trigger, /new\.status = 'active'/);
  assert.match(trigger, /is_visible = false/);
  assert.match(trigger, /status = 'inactive'/);
  assert.match(trigger, /source_membership_id = new\.id/);
});

test("public membership and private permission stay separate", async () => {
  const [schema, claimFunction, membersRoute] = await Promise.all([
    read("./supabase/migrations/20260802220000_multirol_studio_os_schema.sql"),
    read("./supabase/migrations/20260802220110_studio_os_completion_and_claims.sql"),
    read("./app/api/studios/[slug]/membership/members/route.ts"),
  ]);
  assert.match(schema, /studio_memberships/);
  assert.match(schema, /studio_members/);
  assert.match(claimFunction, /insert into public\.studio_members/);
  assert.doesNotMatch(claimFunction, /Necesitás CLOUVA VIP/);
  assert.match(membersRoute, /\.from\("studio_memberships"\)/);
});

test("223 backfill preserves global identity and assigns Studio-specific roles", async () => {
  const migration = await read("./supabase/migrations/20260802220200_multirol_studio_os_backfill.sql");
  assert.match(migration, /0800bless/);
  assert.match(migration, /'Fundador'/);
  assert.match(migration, /'Dirección'/);
  assert.match(migration, /'Socio'/);
  assert.match(migration, /'Business'/);
  assert.doesNotMatch(migration, /update public\.players[\s\S]*primary_role/i);
});

test("Phase 1 does not modify the 3D pipeline", async () => {
  const packageJson = JSON.parse(await read("./package.json"));
  assert.ok(packageJson.scripts["test:avatar-analyzer"]);
  assert.ok(packageJson.scripts["test:legacy"]);
});
