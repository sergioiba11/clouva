import test from "node:test";
import assert from "node:assert/strict";
import {
  cameraDirectionLocal,
  geoToLocalMeters,
  localMetersToGeo,
} from "./lib/structures/spatial.ts";

const ORIGIN = {
  originLat: -38.9033,
  originLon: -70.0650,
  originAlt: 980,
};

test("geoToLocalMeters maps origin to the local origin", () => {
  const local = geoToLocalMeters({
    lat: ORIGIN.originLat,
    lon: ORIGIN.originLon,
    alt: ORIGIN.originAlt,
    ...ORIGIN,
    northRotationDeg: 0,
  });
  assert.ok(Math.abs(local.x) < 1e-9);
  assert.ok(Math.abs(local.y) < 1e-9);
  assert.ok(Math.abs(local.z) < 1e-9);
});

test("unrotated world uses +X east and -Z north", () => {
  const east = geoToLocalMeters({
    lat: ORIGIN.originLat,
    lon: ORIGIN.originLon + 0.0001,
    ...ORIGIN,
    northRotationDeg: 0,
  });
  const north = geoToLocalMeters({
    lat: ORIGIN.originLat + 0.0001,
    lon: ORIGIN.originLon,
    ...ORIGIN,
    northRotationDeg: 0,
  });
  assert.ok(east.x > 0);
  assert.ok(Math.abs(east.z) < 0.05);
  assert.ok(north.z < 0);
  assert.ok(Math.abs(north.x) < 0.05);
});

test("north rotation rotates geographic north inside the local world", () => {
  const north = geoToLocalMeters({
    lat: ORIGIN.originLat + 0.0001,
    lon: ORIGIN.originLon,
    ...ORIGIN,
    northRotationDeg: 90,
  });
  assert.ok(north.x > 0);
  assert.ok(Math.abs(north.z) < 0.05);
});

test("localMetersToGeo round-trips geographic camera coordinates", () => {
  const source = {
    lat: -38.9029412,
    lon: -70.0643289,
    alt: 984.75,
  };
  const local = geoToLocalMeters({
    ...source,
    ...ORIGIN,
    northRotationDeg: 23.5,
  });
  const restored = localMetersToGeo({
    x: local.x,
    y: local.y,
    z: local.z,
    ...ORIGIN,
    northRotationDeg: 23.5,
  });

  assert.ok(Math.abs(restored.latitude - source.lat) < 1e-8);
  assert.ok(Math.abs(restored.longitude - source.lon) < 1e-8);
  assert.ok(Math.abs(restored.altitude - source.alt) < 1e-8);
});

test("camera heading follows geographic convention", () => {
  const north = cameraDirectionLocal({ headingDeg: 0, pitchDeg: 0, northRotationDeg: 0 });
  const east = cameraDirectionLocal({ headingDeg: 90, pitchDeg: 0, northRotationDeg: 0 });
  assert.ok(Math.abs(north.x) < 1e-9);
  assert.ok(Math.abs(north.z + 1) < 1e-9);
  assert.ok(Math.abs(east.x - 1) < 1e-9);
  assert.ok(Math.abs(east.z) < 1e-9);
});

test("camera pitch produces normalized vertical direction", () => {
  const direction = cameraDirectionLocal({ headingDeg: 0, pitchDeg: 30, northRotationDeg: 0 });
  assert.ok(direction.y > 0);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
});
