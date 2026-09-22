import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("IGLÚ home routes public controls into functional surfaces", async () => {
  const source = await read("./components/iglu/IgluPublicSpotHome.tsx");
  assert.match(source, /\/reservar/);
  assert.match(source, /\/media/);
  assert.match(source, /\/perfil/);
  assert.match(source, /IgluMerchCarousel/);
});

test("IGLÚ booking binds the selected Player to the atomic Agenda booking", async () => {
  const route = await read("./app/api/studios/[slug]/bookings/route.ts");
  const migration = await read("./supabase/migrations/20260921190000_studio_player_booking_agenda.sql");
  assert.match(route, /playerId/);
  assert.match(route, /create_studio_booking_with_player_agenda/);
  assert.match(migration, /private\.agenda_slot_is_available\(v_host_agenda\.id/);
  assert.match(migration, /host_player_id/);
});

test("IGLÚ calendar supports mobile long press without replacing canonical Agenda", async () => {
  const source = await read("./components/iglu/IgluUnifiedCalendar.tsx");
  assert.match(source, /onPointerDown/);
  assert.match(source, /onPointerCancel/);
  assert.match(source, /460/);
  assert.match(source, /Ocupado/);
});

test("IGLÚ Media uses the canonical radio bucket and real library", async () => {
  const api = await read("./app/api/iglu/media/audio/route.ts");
  const page = await read("./components/iglu/IgluMediaLive.tsx");
  assert.match(api, /iglu-radio/);
  assert.match(api, /radio_tracks/);
  assert.match(page, /\/api\/integrations\/youtube\/status/);
  assert.match(page, /ProfileRadioSettingsCard/);
});


test("IGLÚ calendar aggregates canonical Player agendas and real availability rules", async () => {
  const loader = await read("./lib/server/iglu/public-app.ts");
  const calendar = await read("./components/iglu/IgluUnifiedCalendar.tsx");
  assert.match(loader, /getAgendaOccurrences/);
  assert.match(loader, /agenda_availability_rules/);
  assert.match(loader, /playerId:/);
  assert.match(calendar, /Players con presencia en El Iglú/);
  assert.match(calendar, /statusAvailable/);
  assert.match(calendar, /RESERVAS/);
});

test("IGLÚ booking discovers public producers without hardcoded names", async () => {
  const api = await read("./app/api/iglu/reservas/producers/route.ts");
  const booking = await read("./components/iglu/IgluBookingDiscovery.tsx");
  assert.match(api, /professional_categories/);
  assert.match(api, /user_entitlements/);
  assert.match(api, /distanceKm/);
  assert.doesNotMatch(api, /Joyze|Palermo/);
  assert.match(booking, /Recomendado para vos/);
  assert.match(booking, /Otros productores/);
});


test("IGLÚ public home exposes real mobile touch targets and non-blocking artwork", async () => {
  const home = await read("./components/iglu/IgluPublicSpotHome.tsx");
  const css = await read("./components/iglu/IgluPublicSpotHome.module.css");
  assert.match(home, /contentStack/);
  assert.match(home, /sr-only">Inicio/);
  assert.match(home, /sr-only">Perfil/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /min-height:\s*56px/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /grid-template-columns:\s*20fr 22fr 16fr 22fr 20fr/);
  assert.match(css, /transform:\s*scale\(0\.975\)/);
});

test("IGLÚ merch distinguishes a tap from a horizontal swipe", async () => {
  const source = await read("./components/iglu/IgluMerchCarousel.tsx");
  assert.match(source, /DRAG_THRESHOLD\s*=\s*8/);
  assert.match(source, /onPointerDown/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /onPointerCancel/);
  assert.match(source, /preventDefault\(\)/);
  assert.match(source, /pan-y pinch-zoom/);
  assert.match(source, /pointerEvents:\s*"none"/);
});
