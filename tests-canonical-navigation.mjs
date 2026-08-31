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

test("visitor Home keeps landing, login and Matrix discovery separated", () => {
  const homeExperience = read("./components/clouva/HomeExperience.tsx");
  const landing = read("./components/clouva/PublicLanding.tsx");

  assert.match(homeExperience, /if \(!user\) return <PublicLanding/);
  assert.match(homeExperience, /<MobileHomeDashboard/);
  assert.match(homeExperience, /<HomeDashboard/);
  assert.match(landing, /href="\/login"[\s\S]*?Entrar/);
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
  assert.equal(getPlayerDestination(null), "/onboarding/identity");
  assert.equal(
    getPlayerDestination({ slug: "clouva", is_published: false, publication_status: "draft" }),
    "/profile/edit",
  );
  assert.equal(
    getPlayerDestination({ slug: "clouva", is_published: true, publication_status: "published" }),
    "/clouva",
  );
  assert.equal(
    getPlayerDestination({ slug: "Bless Music", is_published: true, publication_status: "published" }),
    "/Bless%20Music",
  );
});

test("master navigation contract is shared and keeps product concepts separate", () => {
  assert.equal(CLOUVA_NAVIGATION.HOME.href, "/");
  assert.equal(CLOUVA_NAVIGATION.PLAYER.href, "/perfil");
  assert.equal(CLOUVA_NAVIGATION.MI_FLOW.href, "/mi-flow");
  assert.equal(CLOUVA_NAVIGATION.CREATE.href, "/crear");
  assert.equal(CLOUVA_NAVIGATION.MI_SPOT.href, "/mi-spot");
  assert.equal(CLOUVA_NAVIGATION.MARKET.href, "/tienda");
  assert.equal(CLOUVA_NAVIGATION.MATRIX.href, "/matrix");
  assert.equal(CLOUVA_NAVIGATION.STUDIOS.href, "/studios");

  assert.deepEqual(DESKTOP_PRIMARY_NAV_KEYS, ["HOME", "CREATE", "MARKET", "MATRIX"]);
  assert.deepEqual(MOBILE_PRIMARY_NAV_KEYS, ["HOME", "PLAYER", "CREATE", "MARKET", "MI_FLOW"]);
  assert.notEqual(CLOUVA_NAVIGATION.HOME.href, CLOUVA_NAVIGATION.MI_FLOW.href);
  assert.notEqual(CLOUVA_NAVIGATION.MARKET.href, CLOUVA_NAVIGATION.MATRIX.href);
});

test("legacy aliases are real redirects and canonical UIs do not generate them", () => {
  assert.match(read("./app/shop/page.tsx"), /redirect\(["']\/catalogo["']\)/);
  assert.match(read("./app/account/page.tsx"), /redirect\(["']\/cuenta["']\)/);
  assert.match(read("./app/mi-flow/tasks/page.tsx"), /redirect\(["']\/mi-flow\/tareas["']\)/);

  const canonicalNavigationSources = [
    "./components/clouva/HomeDashboard.tsx",
    "./components/clouva/MobileHomeDashboard.tsx",
    "./components/account/AccountMenu.tsx",
    "./app/crear/page.tsx",
    "./app/mi-flow/menu/page.tsx",
    "./app/perfil/page.tsx",
  ].map(read).join("\n");

  assert.doesNotMatch(canonicalNavigationSources, /href=["']\/shop["']/);
  assert.doesNotMatch(canonicalNavigationSources, /href=["']\/account["']/);
  assert.doesNotMatch(canonicalNavigationSources, /href=["']\/mi-flow\/tasks["']/);
  assert.doesNotMatch(canonicalNavigationSources, /href=["']\/u\//);
});

test("every existing root system route is reserved from public Player aliases", () => {
  const required = [
    "account",
    "admin",
    "api",
    "auth",
    "avatar-analyzer-v4",
    "biblioteca",
    "carrito",
    "catalogo",
    "checkout",
    "clouva-ai",
    "crear",
    "creator-studio",
    "cuenta",
    "debug-auth",
    "empleado",
    "gracias",
    "login",
    "logo",
    "lookbook",
    "matrix",
    "mi-flow",
    "mi-qr",
    "mi-spot",
    "onboarding",
    "pedido",
    "perfil",
    "perfil-publico",
    "players",
    "privacidad",
    "producto",
    "profile",
    "q",
    "registro",
    "shop",
    "sobre-clouva",
    "spaces",
    "studio-dashboard",
    "studios",
    "terminos",
    "tienda",
    "truco",
    "u",
    "vip",
  ];
  for (const alias of required) {
    assert.equal(RESERVED_PUBLIC_ALIASES.has(alias), true, `missing reserved alias ${alias}`);
    assert.equal(isReservedPublicAlias(alias), true);
  }
  assert.equal(normalizePublicAlias(" @CLOUVA "), "clouva");
  assert.equal(isReservedPublicAlias(" @ADMIN "), true);

  const playerApi = read("./app/api/players/me/route.ts");
  assert.match(playerApi, /isReservedPublicAlias/);
  assert.match(playerApi, /public_slug_aliases/);
});

test("Crear is a hub over real existing tools and Media Creator lives below it", () => {
  const createHub = read("./app/crear/page.tsx");
  const media = read("./app/crear/media/page.tsx");

  for (const href of [
    "/crear/media",
    "/clouva-ai",
    "/creator-studio",
    "/mi-flow/avatar",
    "/mi-flow/crear-prenda",
    "/mi-flow/creative",
  ]) {
    assert.match(createHub, new RegExp(href.replaceAll("/", "\\/")));
  }
  assert.match(media, /MediaCreatorPage/);
});

test("desktop and mobile consume the same navigation contract and Player resolver", () => {
  const desktop = read("./components/clouva/HomeDashboard.tsx");
  const mobile = read("./components/clouva/MobileHomeDashboard.tsx");

  assert.match(desktop, /DESKTOP_PRIMARY_NAV_KEYS/);
  assert.match(desktop, /getNavigationItems/);
  assert.match(desktop, /getPlayerDestination\(currentPlayer\)/);
  assert.match(mobile, /MOBILE_PRIMARY_NAV_KEYS/);
  assert.match(mobile, /getNavigationItems/);
  assert.match(mobile, /getPlayerDestination\(currentPlayer\)/);
  assert.doesNotMatch(mobile, /publicProfileHref\s*=\s*["']\/mi-flow["']/);
});

test("AccountMenu is personal, compact and admin-gated", () => {
  const menu = read("./components/account/AccountMenu.tsx");
  for (const label of [
    "MI FLOW",
    "MI SPOT",
    "MI PLAYER / PERFIL PÚBLICO",
    "MI QR",
    "CONFIGURACIÓN",
    "TODO CLOUVA",
    "MIS ESTUDIOS",
    "CAMBIAR CUENTA",
    "CERRAR SESIÓN",
  ]) {
    assert.match(menu, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(menu, /canAdmin\s*\?/);
  assert.match(menu, /href="\/admin"/);
});

test("onboarding and VIP flows close at Home while preserving explicit continuations", () => {
  const vipOffer = read("./app/onboarding/vip-offer/page.tsx");
  const vipPage = read("./app/vip/page.tsx");
  const login = read("./app/login/login-content.tsx");

  assert.match(vipOffer, /router\.replace\(["']\/["']\)/);
  assert.match(vipPage, /router\.replace\(["']\/["']\)/);
  assert.match(login, /studioRedirectOverride/);
  assert.match(login, /resolvePostLoginDestination/);
  assert.match(login, /getRedirectByRole/);
});

test("legacy public profile routes progressively resolve to the root Player alias", () => {
  const usernameLegacy = read("./app/u/[username]/page.tsx");
  const idLegacy = read("./app/perfil-publico/[id]/page.tsx");
  const slugLegacy = read("./app/players/[slug]/page.tsx");

  assert.match(usernameLegacy, /router\.replace\(`\/\$\{encodeURIComponent\(/);
  assert.match(idLegacy, /router\.replace\(`\/\$\{encodeURIComponent\(/);
  assert.match(slugLegacy, /redirect\(/);
});

test("Market and Studio layers retain distinct canonical responsibilities", () => {
  const docs = read("./docs/CLOUVA_CANONICAL_NAVIGATION.md");
  assert.match(docs, /\/tienda/);
  assert.match(docs, /\/catalogo/);
  assert.match(docs, /\/producto\/\[slug\]/);
  assert.match(docs, /\/producto\/id\/\[id\]/);
  assert.match(docs, /\/studios\/\[slug\]/);
  assert.match(docs, /\/studio-dashboard\/\[studioId\]/);
  assert.match(docs, /\/admin\/estudios/);
});
