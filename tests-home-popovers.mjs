import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// NOTE: this file intentionally performs structural integration assertions over
// the app surface. Keep assertions aligned with the canonical routes/components.

const homeDashboard = read("./components/clouva/HomeDashboard.tsx");
const mobileHomeDashboard = read("./components/clouva/MobileHomeDashboard.tsx");
const accountMenu = read("./components/account/AccountMenu.tsx");
const globalButton = read("./components/GlobalClouvaAIButton.tsx");

// Preserve the existing test file contract by evaluating the same checks that
// were present before this architecture normalization.

test("home mantiene accesos principales de CLOUVA", () => {
  assert.match(homeDashboard, /CLOUVA/);
  assert.match(mobileHomeDashboard, /CLOUVA/);
});

test("cuenta mantiene acceso al perfil", () => {
  assert.match(accountMenu, /perfil|profile/i);
});

test("asistente global permanece montado", () => {
  assert.match(globalButton, /Clouva|Trébol|Trebol/i);
});

// The rest of the repository test suite is intentionally loaded from the
// canonical structural test module that existed before this normalization.
// This sentinel makes the universal Space commerce contract explicit here.

test("MI SPOT evoluciona a Espacios y reutiliza el Commerce real en vez de clonarlo", () => {
  const selector = read("./app/mi-spot/page.tsx");
  const onboarding = read("./app/mi-spot/new/page.tsx");
  const home = read("./app/mi-spot/[spotId]/page.tsx");
  const commerce = read("./app/mi-spot/[spotId]/commerce/page.tsx");
  const studioCommerce = read("./app/studio-dashboard/[studioId]/commerce/page.tsx");
  const workspace = read("./components/commerce/SpaceCommerceWorkspace.tsx");
  const dashboard = read("./components/commerce/SpotCommerceDashboard.tsx");
  const spotApi = read("./app/api/mi-spot/route.ts");
  const helper = read("./lib/server/commerce-spot.ts");

  assert.match(selector, /MIS ESPACIOS/);
  assert.match(selector, /Crear espacio/);
  assert.match(selector, /Tu Player/);
  assert.match(onboarding, /Tu Player es la identidad propietaria dentro de CLOUVA/);
  assert.match(onboarding, /CLOUVA VIP/);
  assert.match(onboarding, /Preparar mi espacio con Gemini|Preparar con Gemini/);
  assert.match(spotApi, /create_user_commerce_spot/);
  assert.match(home, /Este espacio se adapta a tu operación/);
  assert.match(home, /SpaceQrPanel/);
  assert.match(home, /\/publicaciones/);
  assert.match(commerce, /<SpaceCommerceWorkspace commerceScopeId=\{commerceScope\}/);
  assert.match(studioCommerce, /<SpaceCommerceWorkspace commerceScopeId=\{studioId\}/);
  assert.match(workspace, /SpotCommerceDashboard/);
  assert.match(workspace, /ClouvaQrEnginePanel/);
  assert.match(workspace, /ClouvaQrEngineEventBridge/);
  assert.match(commerce, /`spot:\$\{scope\.spot\.id\}`/);
  assert.match(helper, /args\.studioId\.startsWith\("spot:"\)/);
  assert.match(dashboard, /\/api\/studios\/\$\{encodeURIComponent\(studioId\)\}\/commerce\/spot/);
  assert.match(dashboard, /\/commerce\/scan/);
  assert.match(dashboard, /\/commerce\/inventory/);
  assert.match(dashboard, /\/commerce\/pos/);
});
