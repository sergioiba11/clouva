import "./tests-body-contract.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const exportStudio = readFileSync("./components/library/UnrealObjectExport.tsx", "utf8");
const realReview = readFileSync("./components/library/RealGarmentReview.tsx", "utf8");
const riggedViewer = readFileSync("./components/library/RiggedGarmentReviewViewer.tsx", "utf8");
const finalizeRoute = readFileSync("./app/api/clothing/finalize/route.ts", "utf8");

test("Meshy crudo nunca se presenta como prenda vestida", () => {
  assert.doesNotMatch(exportStudio, /SmartTryOnViewer/);
  assert.match(exportStudio, /Original de Meshy/);
  assert.match(realReview, /Todavía no está vestido sobre el avatar/);
  assert.match(realReview, /GENERAR VISTA RIGGEADA REAL/);
});

test("la aprobación y exportación exigen rig real", () => {
  assert.match(exportStudio, /selected\.rigged && approved/);
  assert.match(exportStudio, /!selected\.rigged \|\| !previewReady/);
  assert.match(exportStudio, /PRIMERO GENERÁ EL RIG REAL/);
  assert.match(exportStudio, /RIG REAL/);
});

test("el visor sincroniza huesos de la prenda con el avatar", () => {
  assert.match(riggedViewer, /collectBones/);
  assert.match(riggedViewer, /bonePairsRef/);
  assert.match(riggedViewer, /target\.quaternion\.copy\(source\.quaternion\)/);
  assert.match(riggedViewer, /target\.position\.copy\(source\.position\)/);
  assert.match(riggedViewer, /huesos sincronizados con el avatar/);
});

test("la generación de preview usa el pipeline persistente de Blender", () => {
  assert.match(realReview, /\/api\/clothing\/finalize/);
  assert.match(finalizeRoute, /maxDuration = 300/);
  assert.match(realReview, /data\.rigged/);
});
