import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const unrealRoute = readFileSync("./app/api/unreal/avatar/route.ts", "utf8");
const finalizeRoute = readFileSync("./app/api/clothing/finalize/route.ts", "utf8");
const finalizationV2 = readFileSync("./lib/clothing-finalization-v2.ts", "utf8");
const workerV16 = readFileSync("./worker/garment-rig/app_v16.py", "utf8");

test("Unreal solo entrega snapshots recientes", () => {
  assert.match(unrealRoute, /snapshotFresh/);
  assert.match(unrealRoute, /snapshotFresh \? publicSnapshot/);
});

test("el molde vuelve a usar la prenda original de Meshy", () => {
  assert.match(finalizeRoute, /clothing-finalization-v2/);
  assert.match(finalizationV2, /source_meshy_model_url/);
  assert.match(finalizationV2, /force_fresh_source: true/);
});

test("el Worker expone la causa real del fallo", () => {
  assert.match(workerV16, /_failure_from_job/);
  assert.match(workerV16, /technicalError/);
  assert.match(workerV16, /diagnostics\/unreal-mold/);
});
