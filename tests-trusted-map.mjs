import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const api = read("app/api/trusted-map/route.ts");
const page = read("app/mapa-de-confianza/page.tsx");
const migration = read("supabase/migrations/20260903154000_trusted_map_and_purchase_privacy.sql");
const legacyHardening = read("supabase/migrations/20260903161000_harden_legacy_player_live_location.sql");
const publicPlayer = [
  read("components/public/PlayerPublicView.tsx"),
  read("components/public/PlayerPublicLocationCard.tsx"),
  read("components/public/PlayerLocationMap.tsx"),
].join("\n");

test("trusted map API is authenticated and derives identity from session", () => {
  assert.match(api, /requireUser\(request\)/);
  assert.match(api, /user\.id/);
  assert.doesNotMatch(api, /const\s+userId\s*=\s*(?:cleanText|validUuid)\(body\.userId/);
});

test("connection invitation starts pending and only recipient can resolve it", () => {
  assert.match(api, /action === ["']invite["']/);
  assert.match(api, /status: ["']pending["']/);
  assert.match(api, /\[["']accept["'], ["']reject["']\]\.includes\(action\)/);
  assert.match(api, /recipient_user_id/);
  assert.match(api, /user\.id/);
  assert.match(api, /action === ["']accept["'] \? ["']accepted["'] : ["']rejected["']/);
});

test("revocation is a first-class state and sharing can be stopped", () => {
  assert.match(api, /action === ["']revoke["']/);
  assert.match(api, /status: ["']revoked["']/);
  assert.match(api, /action === ["']pause_location["']/);
  assert.match(api, /sharing_status: ["']paused["']/);
  assert.match(api, /action === ["']stop_location["']/);
  assert.match(api, /from\(["']trusted_map_locations["']\)\.delete\(\)\.eq\(["']user_id["'], user\.id\)/);
});

test("GPS permission is requested only from explicit private-map sharing UI", () => {
  assert.match(page, /onClick=\{startSharing\}/);
  assert.match(page, /Compartir mi ubicación/);
  assert.match(page, /navigator\.geolocation\.watchPosition/);
  assert.match(page, /navigator\.geolocation\.clearWatch/);
  assert.match(page, /enableHighAccuracy: false/);
  assert.match(page, /if \(watchRef\.current !== null\) return/);
  assert.match(page, /if \(!user\) stopWatcher\(\)/);
  assert.match(page, /useEffect\(\(\) => \(\) => stopWatcher\(\)/);
  assert.doesNotMatch(publicPlayer, /navigator\.geolocation|watchPosition|getCurrentPosition/);
});

test("location sharing requires an accepted audience and keeps only one expiring row", () => {
  assert.match(api, /trusted_map_has_audience/);
  assert.match(api, /Necesitás una conexión aceptada antes de compartir ubicación/);
  assert.match(api, /LOCATION_TTL_MS/);
  assert.match(api, /expires_at/);
  assert.match(api, /upsert\([\s\S]*user_id: user\.id[\s\S]*onConflict: ["']user_id["']/);
  assert.doesNotMatch(migration, /trusted_map_location_history|trusted_map_locations_history|location_history/);
  assert.match(migration, /user_id uuid primary key references auth\.users/);
});

test("database RLS protects real location from outsiders", () => {
  assert.match(migration, /alter table public\.trusted_map_locations enable row level security/);
  assert.match(migration, /trusted_map_locations_authorized_read/);
  assert.match(migration, /using \(public\.trusted_map_can_view_user\(user_id\)\)/);
  assert.match(migration, /trusted_map_connections_participants_read/);
  assert.match(migration, /requester_user_id = auth\.uid\(\) or recipient_user_id = auth\.uid\(\)/);
  assert.match(migration, /trusted_map_locations_own_insert/);
  assert.match(migration, /trusted_map_locations_own_update/);
  assert.match(migration, /trusted_map_locations_own_delete/);
  assert.doesNotMatch(migration, /trusted_map_locations[\s\S]{0,180}using \(true\)/i);
});

test("trusted map group access is consent-scoped", () => {
  assert.match(migration, /trusted_map_group_members_status check \(status in \('pending','accepted','rejected','left','revoked'\)\)/);
  assert.match(api, /action === ["']invite_group["']/);
  assert.match(api, /\[["']accept_group["'], ["']reject_group["']\]\.includes\(action\)/);
  assert.match(api, /action === ["']leave_group["']/);
});

test("realtime publishes only the active trusted-map current row", () => {
  assert.match(migration, /alter publication supabase_realtime add table public\.trusted_map_locations/);
  assert.match(migration, /There is deliberately no position-history table/);
  assert.match(legacyHardening, /alter publication supabase_realtime drop table public\.player_live_locations/);
});

test("legacy Player live location cannot expose GPS publicly", () => {
  assert.match(legacyHardening, /drop policy if exists player_live_locations_select_live_or_owner/);
  assert.match(legacyHardening, /create policy player_live_locations_owner_read/);
  assert.match(legacyHardening, /to authenticated/);
  assert.match(legacyHardening, /p\.owner_user_id = auth\.uid\(\)/);
  assert.match(legacyHardening, /revoke all on table public\.player_live_locations from anon/);
  assert.doesNotMatch(legacyHardening, /updated_at > \(now\(\)/);
});
