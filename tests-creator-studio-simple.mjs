import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const studio = readFileSync("./components/creator-studio/CreatorStudioSimple.tsx", "utf8");
const worker = readFileSync("./worker/garment-rig/app_v16.py", "utf8");
const dockerfile = readFileSync("./worker/garment-rig/Dockerfile", "utf8");

test("Creator Studio conserva el flujo simple", () => {
  for (const label of ["Elegir GLB", "Riggear avatar", "Enviar FBX", "Traer data", "Riggear GLB", "VISOR 3D"]) assert.ok(studio.includes(label));
});

test("Worker V16 está activo para el molde", () => {
  assert.ok(dockerfile.includes("app_v16.py"));
  assert.ok(dockerfile.includes("mv app_v16.py app.py"));
  assert.ok(worker.includes("unreal_mold_health_v2"));
});
