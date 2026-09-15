import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("IGLÚ RADIO keeps one canonical audio engine above child routes", () => {
  const layout = read("./app/iglu/radio/layout.tsx");
  const shell = read("./components/iglu-radio/IgluRadioShell.tsx");
  const igluEngineBridge = read("./components/iglu-radio/PersistentAudioEngine.tsx");
  const engine = read("./components/radio/PersistentAudioEngine.tsx");

  assert.match(layout, /<IgluRadioShell station=\{station\}>\{children\}<\/IgluRadioShell>/);
  assert.match(layout, /resolvePublicProfileRadio\("el-iglu"\)/);
  assert.match(shell, /<PersistentAudioEngine\s*\/>/);
  assert.match(igluEngineBridge, /export \{ PersistentAudioEngine \} from "@\/components\/radio\/PersistentAudioEngine"/);
  assert.equal((engine.match(/<audio/g) || []).length, 1);
  assert.match(engine, /src=\{streamUrl \|\| undefined\}/);
});

test("IGLÚ RADIO client navigation never uses hard reloads", () => {
  const sources = [
    "./components/iglu-radio/RadioHeader.tsx",
    "./components/iglu-radio/RadioHome.tsx",
    "./components/iglu-radio/PersistentRadioPlayer.tsx",
    "./app/iglu/radio/page.tsx",
    "./app/iglu/radio/artistas/page.tsx",
    "./app/iglu/radio/sesiones/page.tsx",
    "./app/iglu/radio/programas/page.tsx",
    "./app/iglu/radio/schedule/page.tsx",
    "./app/iglu/radio/search/page.tsx",
  ].map(read).join("\n");

  assert.doesNotMatch(sources, /window\.location/);
  assert.doesNotMatch(sources, /location\.reload/);
  assert.doesNotMatch(sources, /<audio/);
});

test("IGLÚ RADIO does not invent a stream and the canonical provider models real signal states", () => {
  const config = read("./lib/iglu-radio/config.ts");
  const types = read("./lib/iglu-radio/types.ts");
  const igluProviderBridge = read("./components/iglu-radio/RadioProvider.tsx");
  const provider = read("./components/radio/RadioProvider.tsx");

  assert.match(config, /NEXT_PUBLIC_IGLU_RADIO_STREAM_URL/);
  for (const state of ["IDLE", "CONNECTING", "LIVE", "OFFLINE", "ERROR"]) {
    assert.match(types, new RegExp(`"${state}"`));
  }
  assert.match(igluProviderBridge, /RadioProvider as CoreRadioProvider/);
  assert.match(provider, /case "playing":[\s\S]*?setStatus\("LIVE"\)/);
  assert.match(provider, /setStatus\(hasStream \? "IDLE" : "OFFLINE"\)/);
});

test("profile radios resolve against the real reusable owner schema", () => {
  const resolver = read("./lib/server/profile-radio-data.ts");
  const settings = read("./components/radio/ProfileRadioSettingsCard.tsx");

  assert.match(resolver, /\.from\("profile_radio_settings"\)/);
  assert.match(resolver, /player_id,space_id,studio_id,station_name,tagline,stream_url,artwork_url,is_enabled,is_public/);
  assert.match(resolver, /ownerColumn\(identity\.ownerKind\)/);
  assert.match(resolver, /IGLU_RADIO_STREAM_URL/);
  assert.doesNotMatch(resolver, /profile_type/);
  assert.doesNotMatch(resolver, /profile_id/);
  assert.doesNotMatch(resolver, /now_playing_/);

  assert.match(settings, /\.from\("profile_radio_settings"\)/);
  assert.match(settings, /"player_id"/);
  assert.match(settings, /"studio_id"/);
  assert.match(settings, /"space_id"/);
  assert.match(settings, /Activar mi radio/);
});

test("profile radios keep playback scoped to their own route layout", () => {
  const layout = read("./app/[publicAlias]/radio/layout.tsx");
  const shell = read("./components/radio/ProfileRadioShell.tsx");
  const rootLayout = read("./app/layout.tsx");

  assert.match(layout, /<ProfileRadioShell station=\{station\}>\{children\}<\/ProfileRadioShell>/);
  assert.match(shell, /<RadioProvider station=\{station\}>/);
  assert.match(shell, /<PersistentAudioEngine\s*\/>/);
  assert.doesNotMatch(rootLayout, /RadioProvider/);
  assert.doesNotMatch(rootLayout, /PersistentAudioEngine/);
});

test("public station status never fabricates LIVE", () => {
  const route = read("./app/api/radio/[publicAlias]/status/route.ts");

  assert.match(route, /station\.streamUrl \? "IDLE" : "OFFLINE"/);
  assert.doesNotMatch(route, /status:\s*"LIVE"/);
});
