import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("location text is normalized before persistence", () => {
  assert.equal(normalizeLocationText("  Zapala ,   Neuquén, Argentina  "), "Zapala, Neuquén, Argentina");
});

test("new Player location resolves and persists coordinates", async () => {
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

test("changing location refreshes coordinates", async () => {
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

test("clearing public location clears coordinates without geocoding", async () => {
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

test("unchanged location with coordinates never calls provider", async () => {
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

test("legacy location without coordinates is resolved on the next save", async () => {
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

test("unresolvable location fails before a database mutation can be produced", async () => {
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

test("Player public contract exposes coordinates and canonical page never geocodes", () => {
  const playersData = readFileSync("lib/players-data.ts", "utf8");
  const publicLoader = readFileSync("lib/server/public-identity-data.ts", "utf8");
  assert.match(playersData, /origin,location,latitude,longitude,genres/);
  assert.doesNotMatch(publicLoader, /geocodeLocation|resolvePlayerLocationChange/);
});

test("canonical PATCH owns location geocoding and client cannot edit raw coordinates", () => {
  const route = readFileSync("app/api/players/me/route.ts", "utf8");
  assert.match(route, /resolvePlayerLocationChange/);
  assert.match(route, /field: "location"/);
  const editableFields = route.slice(route.indexOf("const EDITABLE_FIELDS"), route.indexOf("async function findEditablePlayer"));
  assert.doesNotMatch(editableFields, /latitude|longitude/);
});

test("public hero renders real MapLibre layer only with persisted Player coordinates and keeps cover fallback", () => {
  const view = readFileSync("components/public/PlayerPublicView.tsx", "utf8");
  const map = readFileSync("components/public/PlayerLocationMap.tsx", "utf8");
  assert.match(view, /const cover = player\.cover_url \|\| player\.hero_image_url/);
  assert.match(view, /const hasLocationMap = Boolean/);
  assert.match(view, /player\.location/);
  assert.match(view, /Number\.isFinite\(player\.latitude\)/);
  assert.match(view, /<PlayerLocationMap/);
  assert.match(map, /maplibre-gl@\$\{MAPLIBRE_VERSION\}/);
  assert.match(map, /tiles\.openfreemap\.org\/styles\/dark/);
  assert.match(map, /interactive: false/);
  assert.doesNotMatch(map, /navigator\.geolocation/);
  assert.doesNotMatch(map, /NEXT_PUBLIC_[A-Z0-9_]*(TOKEN|KEY|SECRET)/);
});
