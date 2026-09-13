import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const usersApi = read("./app/api/admin/users/route.ts");
const usersPage = read("./app/admin/clientes/page.tsx");
const serverSupabase = read("./lib/server/supabase.ts");
const mediaAuth = read("./lib/server/media-auth.ts");
const clouvaControl = read("./lib/server/clouva-control.ts");

test("admin users API validates the Supabase user before privileged reads or writes", () => {
  assert.match(usersApi, /await requireUser\(request\)/);
  assert.match(usersApi, /createAdminSupabase\(\)/);
  assert.match(usersApi, /profile\?\.role !== "admin" && profile\?\.role_v2 !== "admin"/);
  assert.match(usersApi, /export async function PATCH/);
});

test("admin user PATCH only accepts the two existing account-control flags", () => {
  const patchSection = usersApi.split("export async function PATCH")[1] ?? "";
  assert.match(patchSection, /is_vip\?: unknown/);
  assert.match(patchSection, /is_blocked\?: unknown/);
  assert.doesNotMatch(patchSection, /role\?: unknown/);
  assert.doesNotMatch(patchSection, /role_v2\?: unknown/);
  assert.match(patchSection, /\.update\(patch\)/);
});

test("admin client no longer mutates profiles directly from the browser", () => {
  assert.match(usersPage, /authenticatedFetch\("\/api\/admin\/users", \{[\s\S]*method: "PATCH"/);
  assert.doesNotMatch(usersPage, /\.from\("profiles"\)\.update/);
});

test("authenticated API choke point validates token and enforces account blocking with service role", () => {
  assert.match(serverSupabase, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(serverSupabase, /createAdminSupabase\(\)[\s\S]*\.from\("profiles"\)[\s\S]*\.select\("is_blocked"\)/);
  assert.match(serverSupabase, /if \(profile\?\.is_blocked\) throw new Error\("Esta cuenta fue bloqueada\."\)/);
});

test("media admin and CLOUVA Control keep server-side authorization gates", () => {
  assert.match(mediaAuth, /await requireUser\(request\)/);
  assert.match(mediaAuth, /createAdminSupabase\(\)/);
  assert.match(mediaAuth, /admin_required/);
  assert.match(clouvaControl, /client\.auth\.getUser\(token\)/);
  assert.match(clouvaControl, /client\.rpc\("clouva_control_is_admin"\)/);
  assert.match(clouvaControl, /Acceso administrativo requerido/);
});
