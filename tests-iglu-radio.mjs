import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("IGLÚ RADIO keeps one audio engine above child routes", () => {
  const layout = read("./app/iglu/radio/layout.tsx");
  const shell = read("./components/iglu-radio/IgluRadioShell.tsx");
  const engine = read("./components/iglu-radio/PersistentAudioEngine.tsx");

  assert.match(layout, /<IgluRadioShell>\{children\}<\/IgluRadioShell>/);
  assert.match(shell, /<PersistentAudioEngine\s*\/>/);
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

test("IGLÚ RADIO does not invent a stream and models real signal states", () => {
  const config = read("./lib/iglu-radio/config.ts");
  const types = read("./lib/iglu-radio/types.ts");
  const provider = read("./components/iglu-radio/RadioProvider.tsx");

  assert.match(config, /NEXT_PUBLIC_IGLU_RADIO_STREAM_URL/);
  for (const state of ["IDLE", "CONNECTING", "LIVE", "OFFLINE", "ERROR"]) {
    assert.match(types, new RegExp(`"${state}"`));
  }
  assert.match(provider, /case "playing":[\s\S]*?setStatus\("LIVE"\)/);
  assert.match(provider, /hasStream \? "IDLE" : "OFFLINE"/);
});
