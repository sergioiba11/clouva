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
