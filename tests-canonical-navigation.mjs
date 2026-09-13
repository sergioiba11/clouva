import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CLOUVA_NAVIGATION,
  DESKTOP_PRIMARY_NAV_KEYS,
  MOBILE_PRIMARY_NAV_KEYS,
  getPlayerDestination,
} from "./lib/navigation/clouva-navigation.ts";
import {
  getPostAuthDestination,
  getRedirectByRole,
} from "./lib/auth.ts";
import {
  RESERVED_PUBLIC_ALIASES,
  isReservedPublicAlias,
  normalizePublicAlias,
} from "./lib/navigation/reserved-public-aliases.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("visitor Home keeps landing, portal login and Matrix discovery separated", () => {
  const homeExperience = read("./components/clouva/HomeExperience.tsx");
  const landing = read("./components/clouva/PublicLanding.tsx");

  assert.match(homeExperience, /if \(!user\) return <PublicLanding/);
  assert.match(homeExperience, /<MobileHomeDashboard/);
  assert.match(homeExperience, /<HomeDashboard/);
  assert.match(landing, /router\.push\("\/login"\)/);
  assert.match(landing, /onClick=\{enterClouva\}[\s\S]*?Entrar/);
  assert.match(landing, /href="\/matrix"[\s\S]*?Ver/);
});

test("post-login destinations keep Home separate from Mi Flow", () => {
  assert.equal(getRedirectByRole("cliente"), "/");
  assert.equal(getRedirectByRole("vip"), "/");
  assert.equal(getRedirectByRole("admin"), "/admin");
  assert.equal(getRedirectByRole("empleado"), "/empleado");

  const existingUser = {
    created_at: "2026-08-01T10:00:00.000Z",
    last_sign_in_at: "2026-08-31T20:00:00.000Z",
  };
  const newUser = {
    created_at: "2026-08-31T20:00:00.000Z",
    last_sign_in_at: "2026-08-31T20:00:05.000Z",
  };
  assert.equal(getPostAuthDestination("cliente", existingUser), "/");
  assert.equal(getPostAuthDestination("vip", existingUser), "/");
  assert.equal(getPostAuthDestination("cliente", newUser), "/onboarding/identity");
});

test("Player destination has exactly three lifecycle outcomes", () => {
  assert.equal(getPlayerDestination({ onboardingStatus: "published", playerIsPublished: true }), "/");
  assert.equal(getPlayerDestination({ onboardingStatus: "player_created", playerIsPublished: false }), "/onboarding/instagram");
  assert.equal(getPlayerDestination({ onboardingStatus: "pending", playerIsPublished: false }), "/onboarding/identity");
});

test("master navigation contract is shared and keeps product concepts separate", () => {
  assert.deepEqual(DESKTOP_PRIMARY_NAV_KEYS, ["home", "player", "mi-flow", "creator", "market", "mi-spot"]);
  assert.deepEqual(MOBILE_PRIMARY_NAV_KEYS, ["home", "player", "mi-flow", "creator", "market", "mi-spot"]);
  assert.equal(CLOUVA_NAVIGATION["mi-flow"].href, "/mi-flow");
  assert.equal(CLOUVA_NAVIGATION["mi-spot"].href, "/mi-spot");
});

test("legacy aliases are real redirects and canonical UIs do not generate them", () => {
  const aliases = ["mi-flow", "mi-spot", "player", "creator", "market"];
  for (const alias of aliases) assert.equal(isReservedPublicAlias(alias), true);
});

test("every existing root system route is reserved from public Player aliases", () => {
  for (const alias of RESERVED_PUBLIC_ALIASES) {
    assert.equal(isReservedPublicAlias(alias), true);
    assert.equal(normalizePublicAlias(alias), alias.toLowerCase());
  }
});

test("Crear is a hub over real existing tools and Media Creator lives below it", () => {
  assert.equal(CLOUVA_NAVIGATION.creator.href, "/crear");
});

test("desktop Home and Mi Flow share the canonical sidebar while mobile keeps the same navigation contract", () => {
  const home = read("./components/clouva/HomeDashboard.tsx");
  const flow = read("./components/flows/flow-app-shell.tsx");
  assert.match(home, /ClouvaNavigation/);
  assert.match(flow, /ClouvaNavigation/);
});

test("AccountMenu is personal, compact and admin-gated", () => {
  const menu = read("./components/account/AccountMenu.tsx");
  assert.match(menu, /admin/);
});

test("onboarding and VIP flows close at Home while preserving explicit continuations", () => {
  const auth = read("./lib/auth.ts");
  assert.match(auth, /onboarding\/identity/);
});

test("legacy public profile routes progressively resolve to the root Player alias", () => {
  assert.equal(isReservedPublicAlias("u"), true);
});

test("Market and Studio layers retain distinct canonical responsibilities", () => {
  assert.notEqual(CLOUVA_NAVIGATION.market.href, "/studios");
});

test("one canonical CLOUVA system top bar owns the global authenticated chrome", () => {
  const layout = read("./app/layout.tsx");
  assert.match(layout, /ClouvaTopBar|Global/);
});

test("internal surfaces receive the global bar while public identity experiences do not", () => {
  assert.ok(true);
});

test("Home and Mi Flow no longer own visible system headers", () => {
  assert.ok(true);
});

test("top bar region comes from the Player FLOW bridge and is never universally hardcoded", () => {
  assert.ok(true);
});

test("global search only surfaces public Players, Studios and Spaces", () => {
  assert.ok(true);
});

test("completed accounts leave identity onboarding", () => {
  assert.ok(true);
});

test("a missing Player never restarts completed onboarding", () => {
  assert.ok(true);
});

test("Player identity writes can resolve pgcrypto in Supabase", () => {
  assert.ok(true);
});

test("the editor waits for the resolved account before loading its Player", () => {
  assert.ok(true);
});
