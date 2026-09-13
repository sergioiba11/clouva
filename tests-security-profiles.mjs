import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read("./supabase/migrations/20260912234500_security_hardening_v1.sql");
const authProvider = read("./components/auth-provider.tsx");

const insertGrant = migration.match(/grant insert \(([\s\S]*?)\) on public\.profiles to authenticated;/i)?.[1] ?? "";
const updateGrant = migration.match(/grant update \(([\s\S]*?)\) on public\.profiles to authenticated;/i)?.[1] ?? "";

for (const column of ["role", "role_v2", "is_vip", "is_blocked"]) {
  test(`authenticated profile writes never grant ${column}`, () => {
    assert.doesNotMatch(insertGrant, new RegExp(`\\b${column}\\b`, "i"));
    assert.doesNotMatch(updateGrant, new RegExp(`\\b${column}\\b`, "i"));
  });
}

test("profiles are self-readable only and no public profile policy remains", () => {
  assert.match(migration, /drop policy if exists "profiles_select_public"/i);
  assert.match(migration, /create policy "profiles_self_select"[\s\S]*for select[\s\S]*to authenticated[\s\S]*auth\.uid\(\)[\s\S]*= id/i);
  assert.match(migration, /revoke all privileges on table public\.profiles from anon/i);
  assert.doesNotMatch(migration, /create policy "profiles_select_public"/i);
});

test("profile inserts and updates remain scoped to auth.uid", () => {
  assert.match(migration, /create policy "profiles_self_insert"[\s\S]*with check[\s\S]*auth\.uid\(\)[\s\S]*= id/i);
  assert.match(migration, /create policy "profiles_self_update"[\s\S]*using[\s\S]*auth\.uid\(\)[\s\S]*= id[\s\S]*with check[\s\S]*auth\.uid\(\)[\s\S]*= id/i);
});

test("normal profile creation relies on safe database defaults for privileged fields", () => {
  const insertBlock = authProvider.match(/\.from\("profiles"\)[\s\S]*?\.insert\(\{([\s\S]*?)\}\)[\s\S]*?\.select\(PROFILE_COLUMNS\)/)?.[1] ?? "";
  assert.ok(insertBlock, "profile insert block must exist");
  assert.doesNotMatch(insertBlock, /\brole\s*:/);
  assert.doesNotMatch(insertBlock, /\brole_v2\s*:/);
  assert.doesNotMatch(insertBlock, /\bis_vip\s*:/);
  assert.doesNotMatch(insertBlock, /\bis_blocked\s*:/);
  assert.match(migration, /alter column role set default 'customer'/i);
  assert.match(migration, /alter column role_v2 set default 'cliente'/i);
  assert.match(migration, /alter column is_vip set default false/i);
  assert.match(migration, /alter column is_blocked set default false/i);
});

test("ordinary users keep editable personal profile columns", () => {
  for (const column of ["display_name", "full_name", "avatar_url", "avatar_3d_url", "bio", "username", "city", "country_code", "social_links", "spotify_url", "onboarding_status"]) {
    assert.match(updateGrant, new RegExp(`\\b${column}\\b`, "i"));
  }
});
