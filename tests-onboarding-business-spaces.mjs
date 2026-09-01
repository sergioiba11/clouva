import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const identity = read("./app/onboarding/identity/page.tsx");
const basicsPage = read("./app/onboarding/player-basics/page.tsx");
const basicsApi = read("./app/api/onboarding/player-basics/route.ts");
const basicsServer = read("./lib/server/player-basics.ts");
const gate = read("./components/onboarding/PlayerBasicsGate.tsx");
const layout = read("./app/layout.tsx");
const playerApi = read("./app/api/players/me/route.ts");
const businessPage = read("./app/businesses/new/page.tsx");
const businessApi = read("./app/api/businesses/route.ts");
const businessServer = read("./lib/server/business-spaces.ts");
const legacyStudioPage = read("./app/studios/nuevo/page.tsx");
const legacyStudioApi = read("./app/api/studios/create/route.ts");
const managePage = read("./app/businesses/manage/page.tsx");
const searchApi = read("./app/api/spaces/search/route.ts");
const requestApi = read("./app/api/spaces/[spaceId]/management-requests/route.ts");
const reviewApi = read("./app/api/spaces/[spaceId]/management-requests/[requestId]/route.ts");
const teamAccess = read("./lib/server/space-team-access.ts");
const teamPage = read("./app/businesses/[spaceId]/team/page.tsx");
const membershipsPage = read("./app/profile/memberships/page.tsx");
const membershipsApi = read("./app/api/profile/memberships/route.ts");
const migration = read("./supabase/migrations/20260901005000_onboarding_business_spaces.sql");
const spaceCore = read("./supabase/migrations/20260825004237_player_spaces_commerce_miflow_normalization.sql");
const universalCommerce = read("./supabase/migrations/20260823194000_universal_commerce_spots.sql");
const studioApplications = read("./app/api/studios/[slug]/applications/route.ts");

test("A · nombre + @ son un gate global y también requisito server-side", () => {
  assert.match(layout, /<PlayerBasicsGate>/);
  assert.match(gate, /\/api\/onboarding\/player-basics/);
  assert.match(gate, /router\.replace\(`\/onboarding\/player-basics\?next=/);
  assert.match(basicsPage, /title="Tu identidad"/);
  assert.match(basicsPage, /Nombre/);
  assert.match(basicsPage, /@/);
  assert.match(businessServer, /await requirePlayerBasics\(admin, userId\)/);
  assert.match(requestApi, /await requirePlayerBasics\(admin, user\.id\)/);
});

test("B · @ duplicado se bloquea en backend y DB incluso con concurrencia", () => {
  assert.match(basicsServer, /assertPlayerUsernameAvailable/);
  assert.match(basicsServer, /\.ilike\("username", username\)/);
  assert.match(migration, /create unique index if not exists players_username_normalized_unique/);
  assert.match(migration, /on public\.players \(\(lower\(username\)\)\)/);
  assert.match(migration, /create or replace function public\.set_player_basics/);
  assert.match(migration, /raise exception 'Ese @ ya está en uso\.' using errcode = '23505'/);
  assert.match(basicsApi, /error\.code === "23505"/);
});

test("C · @ reservado y formato se validan en toda escritura canónica", () => {
  assert.match(basicsServer, /isReservedPublicAlias\(username\)/);
  assert.match(basicsServer, /USERNAME_RE/);
  assert.match(migration, /players_username_format_check/);
  assert.match(playerApi, /validatePlayerUsername\(body\.username\)/);
  assert.match(playerApi, /assertPlayerUsernameAvailable/);
});

test("D · Ofrecer mis habilidades queda deshabilitado y no activa services", () => {
  assert.ok(identity.indexOf('title: "Explorar CLOUVA"') < identity.indexOf('title: "Personalizar mi Player"'));
  assert.ok(identity.indexOf('title: "Personalizar mi Player"') < identity.indexOf('title: "Crear negocio"'));
  assert.ok(identity.indexOf('title: "Crear negocio"') < identity.indexOf('title: "Administrar un negocio"'));
  assert.ok(identity.indexOf('title: "Administrar un negocio"') < identity.indexOf('title: "Ofrecer mis habilidades"'));
  assert.doesNotMatch(identity, /mode:\s*"services"/);
  assert.doesNotMatch(identity, /next=services/);
  assert.match(identity, /title: "Ofrecer mis habilidades"[\s\S]*destination: null[\s\S]*persistMode: false[\s\S]*disabled: true/);
  assert.match(identity, /Próximamente/);
});

test("E · elegir Crear/Administrar negocio no fabrica ownership ni manager mode", () => {
  assert.match(identity, /key: "create_business"[\s\S]*mode: null[\s\S]*destination: "\/businesses\/new"[\s\S]*persistMode: false/);
  assert.match(identity, /key: "manage_business"[\s\S]*mode: null[\s\S]*destination: "\/businesses\/manage"[\s\S]*persistMode: false/);
  assert.match(businessServer, /create_studio_os_draft|create_user_commerce_spot/);
  assert.doesNotMatch(businessApi, /profile_modes/);
});

test("F/G/H · creación canónica conserva Studio OS y distingue digital/físico", () => {
  assert.match(businessApi, /digital_business/);
  assert.match(businessApi, /physical_business/);
  assert.match(businessApi, /studio/);
  assert.match(businessServer, /kind === "studio"/);
  assert.match(businessServer, /create_studio_os_draft/);
  assert.match(businessServer, /create_user_commerce_spot/);
  assert.match(businessServer, /DIGITAL_MODULES/);
  assert.match(businessServer, /PHYSICAL_MODULES/);
  assert.match(businessServer, /business_kind: kind/);
  assert.match(businessPage, /Negocio digital/);
  assert.match(businessPage, /Negocio físico/);
  assert.match(businessPage, /Estudio/);
});

test("Space Core existente se reutiliza; no aparece una segunda fuente de verdad businesses", () => {
  assert.match(spaceCore, /create table if not exists public\.spaces/);
  assert.match(spaceCore, /legacy_studio_id/);
  assert.match(spaceCore, /legacy_commerce_spot_id/);
  assert.match(spaceCore, /create table if not exists public\.space_members/);
  assert.match(universalCommerce, /create_user_commerce_spot/);
  assert.match(businessServer, /\.from\("spaces"\)/);
  assert.doesNotMatch(migration, /create table(?: if not exists)? public\.businesses/i);
});

test("I/K · solicitar administración crea pending separado de studio_applications y evita duplicados", () => {
  assert.match(migration, /create table if not exists public\.space_management_requests/);
  assert.match(migration, /status text not null default 'pending'/);
  assert.match(migration, /space_management_requests_pending_unique[\s\S]*on public\.space_management_requests\(space_id,user_id\)[\s\S]*where status = 'pending'/);
  assert.match(requestApi, /\.from\("space_management_requests"\)[\s\S]*\.insert/);
  assert.match(requestApi, /status: "pending"/);
  assert.match(requestApi, /REQUEST_ALREADY_PENDING/);
  assert.doesNotMatch(requestApi, /studio_applications/);
  assert.match(studioApplications, /artist_name/);
  assert.match(studioApplications, /presentation/);
});

test("J · pending no crea membresía ni acceso administrativo", () => {
  assert.doesNotMatch(requestApi, /\.from\("space_members"\)[\s\S]*\.insert/);
  assert.doesNotMatch(requestApi, /commerce_spot_members[\s\S]*\.insert/);
  assert.doesNotMatch(requestApi, /studio_members[\s\S]*\.insert/);
  assert.match(requestApi, /redirectTo: "\/"/);
});

test("L/M · sólo owner/admin real puede revisar solicitudes", () => {
  assert.match(teamAccess, /role !== "owner" && role !== "admin"/);
  assert.match(teamAccess, /SPACE_TEAM_FORBIDDEN/);
  assert.match(reviewApi, /requireSpaceTeamReviewAccess\(admin, user\.id, spaceId\)/);
  assert.match(migration, /private\.space_role_for_user\(v_request\.space_id,p_reviewer_user_id\) in \('owner','admin'\)/);
});

test("N/O · aprobación es transaccional e idempotente; rechazo no crea permisos", () => {
  assert.match(migration, /create or replace function public\.review_space_management_request/);
  assert.match(migration, /for update/);
  assert.match(migration, /if v_request\.status <> 'pending' then[\s\S]*if v_request\.status = p_decision then/);
  assert.match(migration, /if p_decision = 'approved' then[\s\S]*insert into public\.space_members/);
  assert.match(migration, /insert into public\.studio_members/);
  assert.match(migration, /insert into public\.commerce_spot_members/);
  assert.match(migration, /set status=p_decision,[\s\S]*reviewed_at=now\(\),[\s\S]*reviewed_by=p_reviewer_user_id/);
  assert.ok(migration.indexOf("if p_decision = 'approved' then") < migration.indexOf("insert into public.space_members"));
  assert.ok(migration.indexOf("insert into public.commerce_spot_members") < migration.indexOf("update public.space_management_requests"));
});

test("review trigger permite activar membresía y resolver request en la misma transacción", () => {
  assert.match(migration, /v_identity_changed boolean := tg_op = 'INSERT'/);
  assert.match(migration, /if v_identity_changed then[\s\S]*Este Player ya forma parte del equipo/);
  assert.match(migration, /A review is allowed[\s\S]*activate membership first/);
});

test("P · después de enviar solicitud vuelve a Home normal como Player", () => {
  assert.match(managePage, /Solicitud enviada/);
  assert.match(managePage, /router\.replace\("\/"\)/);
  assert.match(requestApi, /redirectTo: "\/"/);
});

test("Equipo canónico expone Activos, Solicitudes e Invitaciones", () => {
  assert.match(teamPage, /Activos/);
  assert.match(teamPage, /Solicitudes/);
  assert.match(teamPage, /Invitaciones/);
  assert.match(teamPage, /management-requests/);
  assert.match(teamPage, /decision: "approved"|"rejected"/);
});

test("Mis negocios y espacios distingue relación, request, permisos y módulos", () => {
  assert.match(membershipsPage, /Mis negocios y espacios/);
  assert.match(membershipsPage, /Solicitud pendiente/);
  assert.match(membershipsPage, /membership\.internal_role/);
  assert.match(membershipsPage, /membership\.enabled_modules/);
  assert.match(membershipsApi, /request_status/);
  assert.match(membershipsApi, /can_manage/);
  assert.match(membershipsApi, /enabled_modules/);
  assert.match(membershipsApi, /business_kind/);
});

test("Q · rutas históricas de Studio delegan sin crear implementación paralela", () => {
  assert.match(legacyStudioPage, /redirect\("\/businesses\/new\?type=studio"\)/);
  assert.match(legacyStudioApi, /createBusinessSpace/);
  assert.match(legacyStudioApi, /kind: "studio"/);
  assert.match(legacyStudioApi, /studioOsRequired: true/);
});

test("búsqueda de administración sólo ofrece espacios públicos/activos", () => {
  assert.match(searchApi, /\.eq\("public_enabled", true\)/);
  assert.match(searchApi, /\.eq\("status", "active"\)/);
  assert.match(searchApi, /pendingRequest/);
});
