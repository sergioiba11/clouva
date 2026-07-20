import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("./app/api/creator-studio/body-to-meshy/route.ts", "utf8");
const page = readFileSync("./components/creator-studio/BodyToMeshyExperiment.tsx", "utf8");
const workerApi = readFileSync("./worker/garment-rig/app_v11.py", "utf8");
const bodyScript = readFileSync("./worker/garment-rig/body_contract.py", "utf8");
const dockerfile = readFileSync("./worker/garment-rig/Dockerfile", "utf8");


test("Blender expone un contrato corporal medido desde la malla activa", () => {
  assert.match(workerApi, /@app\.post\("\/body-contract"\)/);
  assert.match(workerApi, /BODY_CONTRACT_VERSION = "body-contract-v1"/);
  assert.match(bodyScript, /def world_vertices\(\)/);
  assert.match(bodyScript, /def build_contract\(points/);
  assert.match(bodyScript, /"sections": sections/);
  assert.match(bodyScript, /"garmentTarget"/);
});


test("la app manda el contrato a Meshy sin superar su límite de prompt", () => {
  assert.match(route, /requestBodyContract\(avatar\.url, category\)/);
  assert.match(route, /createPreviewTask\(prompt, "cartoon"\)/);
  assert.match(route, /slice\(0, 600\)/);
  assert.match(route, /body_contract: contract/);
});


test("la pantalla permite medir, generar y volver a Blender", () => {
  assert.match(page, /GENERAR CON EL CUERPO COMO MOLDE/);
  assert.match(page, /\/api\/creator-studio\/body-to-meshy/);
  assert.match(page, /\/api\/meshy\/status/);
  assert.match(page, /PROBAR AJUSTE Y RIG REAL EN BLENDER/);
  assert.match(page, /\/api\/clothing\/finalize/);
  assert.match(page, /attempt < 60/);
});


test("el contenedor publica la nueva API sin reemplazar las anteriores", () => {
  assert.match(dockerfile, /app_v11\.py/);
  assert.match(dockerfile, /body_contract\.py/);
  assert.match(dockerfile, /assert '\/body-contract' in paths/);
  assert.match(dockerfile, /assert '\/rig' in paths/);
  assert.match(dockerfile, /assert '\/export\/unreal-v2' in paths/);
});
