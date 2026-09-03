import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { normalizeLocationText } from "./lib/server/geocoding.ts";
import { PlayerLocationError, resolvePlayerLocationChange } from "./lib/server/player-location.ts";

const resolvedZapala = {
  latitude: -38.8992,
  longitude: -70.0544,
  displayName: "Zapala, Neuquén, Argentina",
  locality: "Zapala",
  region: "Neuquén",
  country: "Argentina",
};

const read = (path) => readFileSync(path, "utf8");

test("location text is normalized before persistence", () => {
  assert.equal(normalizeLocationText("  Zapala ,   Neuquén, Argentina  "), "Zapala, Neuquén, Argentina");
});

test("new Player location resolves and persists locality coordinates", async () => {
  let calls = 0;
  const changes = await resolvePlayerLocationChange({
    requestedLocation: "Zapala, Neuquén, Argentina",
    currentLocation: null,
    currentLatitude: null,
    currentLongitude: null,
    geocode: async () => { calls += 1; return resolvedZapala; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(changes, {
    location: "Zapala, Neuquén, Argentina",
    latitude: resolvedZapala.latitude,
    longitude: resolvedZapala.longitude,
  });
});

test("changing public locality refreshes coordinates", async () => {
  const changes = await resolvePlayerLocationChange({
    requestedLocation: "Buenos Aires, Argentina",
    currentLocation: "Zapala, Neuquén, Argentina",
    currentLatitude: resolvedZapala.latitude,
    currentLongitude: resolvedZapala.longitude,
    geocode: async () => ({ ...resolvedZapala, latitude: -34.6037, longitude: -58.3816, displayName: "Buenos Aires, Argentina", locality: "Buenos Aires" }),
  });
  assert.equal(changes.location, "Buenos Aires, Argentina");
  assert.equal(changes.latitude, -34.6037);
  assert.equal(changes.longitude, -58.3816);
});

test("clearing public locality clears coordinates without geocoding", async () => {
  let calls = 0;
  const changes = await resolvePlayerLocationChange({
    requestedLocation: "   ",
    currentLocation: "Zapala, Neuquén, Argentina",
    currentLatitude: resolvedZapala.latitude,
    currentLongitude: resolvedZapala.longitude,
    geocode: async () => { calls += 1; return resolvedZapala; },
  });
  assert.equal(calls, 0);
  assert.deepEqual(changes, { location: null, latitude: null, longitude: null });
});

test("unchanged locality with coordinates never calls geocoder", async () => {
  let calls = 0;
  const changes = await resolvePlayerLocationChange({
    requestedLocation: "Zapala, Neuquén, Argentina",
    currentLocation: "Zapala, Neuquén, Argentina",
    currentLatitude: resolvedZapala.latitude,
    currentLongitude: resolvedZapala.longitude,
    geocode: async () => { calls += 1; return resolvedZapala; },
  });
  assert.equal(calls, 0);
  assert.deepEqual(changes, { location: "Zapala, Neuquén, Argentina" });
});

test("legacy public locality without coordinates resolves on next save", async () => {
  let calls = 0;
  const changes = await resolvePlayerLocationChange({
    requestedLocation: "Zapala, Neuquén, Argentina",
    currentLocation: "Zapala, Neuquén, Argentina",
    currentLatitude: null,
    currentLongitude: null,
    geocode: async () => { calls += 1; return resolvedZapala; },
  });
  assert.equal(calls, 1);
  assert.equal(changes.latitude, resolvedZapala.latitude);
  assert.equal(changes.longitude, resolvedZapala.longitude);
});

test("unresolvable locality fails before a database mutation can be produced", async () => {
  await assert.rejects(
    resolvePlayerLocationChange({
      requestedLocation: "Lugar que no existe",
      currentLocation: "Zapala, Neuquén, Argentina",
      currentLatitude: resolvedZapala.latitude,
      currentLongitude: resolvedZapala.longitude,
      geocode: async () => null,
    }),
    (error) => error instanceof PlayerLocationError && error.code === "PLAYER_LOCATION_NOT_FOUND" && error.status === 422,
  );
});

test("Player public contract exposes persisted coordinates and public loader never geocodes", () => {
  const playersData = read("lib/players-data.ts");
  const publicLoader = read("lib/server/public-identity-data.ts");
  assert.match(playersData, /latitude/);
  assert.match(playersData, /longitude/);
  assert.doesNotMatch(publicLoader, /geocodeLocation|resolvePlayerLocationChange/);
});

test("canonical Player PATCH owns locality geocoding and client cannot edit raw coordinates", () => {
  const route = read("app/api/players/me/route.ts");
  assert.match(route, /resolvePlayerLocationChange/);
  assert.match(route, /field: "location"/);
  const editableFields = route.slice(route.indexOf("const EDITABLE_FIELDS"), route.indexOf("async function findEditablePlayer"));
  assert.doesNotMatch(editableFields, /latitude|longitude/);
});

test("public Player renders a compact persisted-locality card, never session GPS", () => {
  const view = read("components/public/PlayerPublicView.tsx");
  const card = read("components/public/PlayerPublicLocationCard.tsx");
  const map = read("components/public/PlayerLocationMap.tsx");
  assert.match(view, /const cover = player\.cover_url \|\| player\.hero_image_url/);
  assert.match(view, /hasLocationMap = Boolean\(player\.location/);
  assert.match(view, /<PlayerPublicLocationCard/);
  assert.match(view, /latitude=\{player\.latitude\}/);
  assert.match(view, /longitude=\{player\.longitude\}/);
  assert.match(card, /aspect-square/);
  assert.match(card, /max-w-\[238px\]/);
  assert.match(card, /Localidad pública elegida/);
  assert.match(map, /interactive: false/);
  assert.match(map, /clouva-location-flicker/);
  assert.match(map, /prefers-reduced-motion/);
  assert.match(map, /attributionControl: false/);
  assert.match(map, /openfreemap\.org/);
  assert.match(map, /openstreetmap\.org\/copyright/);
});

test("public Player surface never invokes or imports private device location", () => {
  const publicFiles = [
    "components/public/PlayerPublicView.tsx",
    "components/public/PlayerPublicLocationCard.tsx",
    "components/public/PlayerLocationMap.tsx",
  ];
  for (const path of publicFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /navigator\.geolocation|watchPosition|getCurrentPosition|trusted_map_locations|user_addresses|account_private_data/, path);
  }
  assert.equal(existsSync("components/public/PlayerSessionLocationCard.tsx"), false);
});

test("public map contains no private provider secret contract", () => {
  const map = read("components/public/PlayerLocationMap.tsx");
  const loader = read("lib/maplibre-browser.ts");
  assert.doesNotMatch(map, /NEXT_PUBLIC_[A-Z0-9_]*(TOKEN|KEY|SECRET)/);
  assert.doesNotMatch(loader, /service_role|SUPABASE_SERVICE_ROLE|SECRET_KEY|PRIVATE_KEY/);
});
