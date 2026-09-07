import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  isPublicClouvaExperiencePath,
  shouldShowClouvaSystemTopBar,
} from "./lib/navigation/clouva-topbar-routes.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("one canonical CLOUVA system top bar owns the global authenticated chrome", () => {
  const rootLayout = read("./app/layout.tsx");
  const canonical = read("./components/clouva/system/ClouvaTopBar.tsx");
  const gate = read("./components/clouva/system/ClouvaSystemTopBarGate.tsx");
  const legacyLayout = read("./components/layout.tsx");

  assert.match(rootLayout, /<ClouvaSystemTopBarGate \/>/);
  assert.doesNotMatch(rootLayout, /<GlobalFlowBalance \/>/);
  assert.match(gate, /shouldShowClouvaSystemTopBar\(pathname\)/);
  assert.match(gate, /return <ClouvaTopBar \/>/);

  for (const contract of [
    /OfficialClouvaMark/,
    /ClouvaGlobalSearch/,
    /<GlobalFlowBalance variant="header" \/>/,
    /<WalletBalanceChip showFlows=\{false\} showDiamonds \/>/,
    /NotificationBell/,
    /AccountMenu/,
  ]) {
    assert.match(canonical, contract);
  }

  // Legacy pages may still import MainNav while the migration settles, but it
  // must never render a second copy of the system bar.
  assert.match(legacyLayout, /export function MainNav\(\)[\s\S]*?return null/);
});

test("internal surfaces receive the global bar while public identity experiences do not", () => {
  for (const pathname of [
    "/",
    "/admin/assets",
    "/mi-flow/billetera",
    "/crear",
    "/creator-studio",
    "/market",
    "/mi-spot",
    "/clouva-ai",
    "/matrix",
    "/agenda",
    "/studio-dashboard/abc/inventario",
    "/businesses/manage",
    "/auto/vehicle-1",
    "/mapa-de-confianza",
    "/player/businesses",
  ]) {
    assert.equal(shouldShowClouvaSystemTopBar(pathname), true, pathname);
  }

  for (const pathname of [
    "/clouva.nlb",
    "/clouva.nlb/store",
    "/u/clouva",
    "/players/clouva",
    "/perfil-publico/123",
    "/studios/el-iglu",
    "/studios/el-iglu/tienda",
    "/spaces/223-social-club",
    "/producto/algo",
    "/tienda",
    "/login",
    "/registro",
    "/onboarding/identity",
  ]) {
    assert.equal(isPublicClouvaExperiencePath(pathname), true, pathname);
  }
});

test("Home and Mi Flow no longer own visible system headers", () => {
  const desktopHome = read("./components/clouva/HomeDashboard.tsx");
  const canonical = read("./components/clouva/system/ClouvaTopBar.tsx");
  const flowShell = read("./components/flows/flow-app-shell.tsx");

  assert.doesNotMatch(desktopHome, /<header className=\{styles\.topbar\}/);
  assert.match(canonical, /data-ui-page="mobile-home"/);
  assert.match(canonical, /data-ui-preview="false"/);

  assert.doesNotMatch(flowShell, /WalletBalanceChip/);
  assert.doesNotMatch(flowShell, /NotificationBell/);
  assert.doesNotMatch(flowShell, /AccountMenu/);
  assert.doesNotMatch(flowShell, /<header className="sticky top-0/);
  assert.match(flowShell, /Abrir navegación de Mi Flow/);
});

test("top bar region comes from the Player FLOW bridge and is never universally hardcoded", () => {
  const canonical = read("./components/clouva/system/ClouvaTopBar.tsx");
  const balanceRoute = read("./app/api/flows/balance/route.ts");

  assert.match(balanceRoute, /getFlowRegionByCountryCode\(profileResult\.data\?\.country_code/);
  assert.match(canonical, /authenticatedFetch\("\/api\/flows\/balance"/);
  assert.match(canonical, /data-clouva-topbar-region=\{region\?\.key/);
  assert.match(canonical, /region\.key === "latam"/);
  assert.match(canonical, /region\.key === "north-america"/);
  assert.doesNotMatch(canonical, /<span[^>]*>\s*LATAM\s*<\/span>/);
});

test("global search only surfaces public Players, Studios and Spaces", () => {
  const route = read("./app/api/search/global/route.ts");
  const search = read("./components/clouva/ClouvaGlobalSearch.tsx");

  assert.match(route, /listPublishedPlayers\(\)/);
  assert.match(route, /listPublishedStudios\(\)/);
  assert.match(route, /\.eq\("public_enabled", true\)/);
  assert.match(route, /\.eq\("status", "active"\)/);
  assert.match(route, /kind: "business"/);
  assert.match(search, /Buscar Players, Negocios, Estudios/);
  assert.match(search, /Los espacios privados nunca aparecen/);
});
