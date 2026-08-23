import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { sanitizeCommerceProductRecognition } from "./lib/commerce/product-recognition.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("./components/commerce/SpotCommerceDashboard.tsx");
const service = read("./lib/server/commerce-product-recognition.ts");
const route = read("./app/api/studios/[slug]/commerce/recognize/route.ts");
const scannerRoute = read("./app/api/studios/[slug]/commerce/scan/route.ts");

test("Gemini product recognition is sanitized before it reaches the form", () => {
  const recognition = sanitizeCommerceProductRecognition({
    detectedObject: "  paquete de papelillos  ",
    name: "OCB Premium",
    brand: "OCB",
    category: "Papelillos",
    description: "Paquete de papelillos premium.",
    productKind: "invalid-kind",
    listingKind: "resale",
    size: "King Size",
    color: "Negro",
    presentation: "32 unidades",
    identifier: { value: "4006381333931", type: "ean_13" },
    visibleText: ["OCB", "Premium", "OCB"],
    uncertainFields: ["fabricante"],
    confidence: { overall: 1.5, identity: 0.94, variant: 0.82, identifier: 0.99 },
  });
  assert.equal(recognition.detectedObject, "paquete de papelillos");
  assert.equal(recognition.productKind, "physical");
  assert.deepEqual(recognition.identifier, { value: "4006381333931", type: "ean_13" });
  assert.deepEqual(recognition.visibleText, ["OCB", "Premium"]);
  assert.equal(recognition.confidence.overall, 1);
});

test("uncertain or invalid identifiers from vision are never registered", () => {
  const lowConfidence = sanitizeCommerceProductRecognition({
    identifier: { value: "4006381333931", type: "ean_13" },
    confidence: { identifier: 0.5 },
  });
  const invalidCheckDigit = sanitizeCommerceProductRecognition({
    identifier: { value: "4006381333932", type: "ean_13" },
    confidence: { identifier: 0.99 },
  });
  assert.equal(lowConfidence.identifier, null);
  assert.equal(invalidCheckDigit.identifier, null);
});

test("visual scanner uses server-side Gemini structured multimodal output", () => {
  assert.match(service, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(service, /NEXT_PUBLIC_GEMINI/);
  assert.match(service, /inlineData/);
  assert.match(service, /responseMimeType:\s*"application\/json"/);
  assert.match(service, /responseJsonSchema:\s*RESPONSE_SCHEMA/);
  assert.match(service, /MAX_TOTAL_BYTES/);
  assert.match(route, /requireManagedSpot/);
  assert.match(route, /recognizeCommerceProduct/);
});

test("scanner captures product views, fills an editable form and preserves canonical creation", () => {
  assert.match(dashboard, /Escanear producto con IA/);
  assert.match(dashboard, /captureProductPhoto\("Frente"\)/);
  assert.match(dashboard, /captureProductPhoto\("Dorso"\)/);
  assert.match(dashboard, /Analizar y completar datos/);
  assert.match(dashboard, /setCreation\(\(current\) =>/);
  assert.match(dashboard, /buildSpotSku/);
  assert.match(dashboard, /source:\s*"gemini_product_vision"/);
  assert.match(scannerRoute, /upsert_commerce_scanned_product/);
});
