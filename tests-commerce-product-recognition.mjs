import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { sanitizeCommerceProductRecognition } from "./lib/commerce/product-recognition.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("./components/commerce/SpotCommerceDashboard.tsx");
const service = read("./lib/server/commerce-product-recognition.ts");
const route = read("./app/api/studios/[slug]/commerce/recognize/route.ts");
const scannerRoute = read("./app/api/studios/[slug]/commerce/scan/route.ts");
const productImagesRoute = read("./app/api/studios/[slug]/commerce/product-images/route.ts");
const captureContract = read("./lib/commerce/product-capture-contract.ts");

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
  assert.match(service, /Frente/);
  assert.match(service, /Atrás/);
  assert.match(service, /Detalle/);
  assert.match(service, /inlineData/);
  assert.match(service, /responseMimeType:\s*"application\/json"/);
  assert.match(service, /responseJsonSchema:\s*RESPONSE_SCHEMA/);
  assert.match(service, /MAX_PRODUCT_TOTAL_BYTES/);
  assert.match(route, /requireManagedSpot/);
  assert.match(route, /recognizeCommerceProduct/);
});

test("product capture contract supports one front, one back and many details", () => {
  assert.match(captureContract, /MAX_PRODUCT_DETAIL_IMAGES\s*=\s*12/);
  assert.match(captureContract, /MAX_PRODUCT_REFERENCE_IMAGES\s*=\s*MAX_PRODUCT_DETAIL_IMAGES\s*\+\s*2/);
  assert.match(captureContract, /orderProductCaptures/);
  assert.match(captureContract, /Frente/);
  assert.match(captureContract, /Atrás/);
  assert.match(captureContract, /Detalle/);
  assert.doesNotMatch(service, /const MAX_IMAGES\s*=\s*3/);
  assert.doesNotMatch(productImagesRoute, /const MAX_IMAGES\s*=\s*3/);
  assert.match(service, /counts\.front\s*!==\s*1/);
  assert.match(service, /counts\.back\s*>\s*1/);
  assert.match(service, /MAX_PRODUCT_DETAIL_IMAGES/);
  assert.match(service, /orderProductCaptures/);
  assert.match(productImagesRoute, /counts\.front\s*!==\s*1/);
  assert.match(productImagesRoute, /counts\.back\s*>\s*1/);
  assert.match(productImagesRoute, /MAX_PRODUCT_DETAIL_IMAGES/);
  assert.match(productImagesRoute, /referenceOrder/);
});

test("scanner captures canonical views, multiple details and preserves canonical creation", () => {
  assert.match(dashboard, /Escanear producto con IA/);
  assert.match(dashboard, /captureProductPhoto\("Frente"\)/);
  assert.match(dashboard, /captureProductPhoto\("Atrás"\)/);
  assert.match(dashboard, /captureProductPhoto\("Detalle"\)/);
  assert.doesNotMatch(dashboard, /captureProductPhoto\("Dorso"\)/);
  assert.match(dashboard, /getFrontCapture/);
  assert.match(dashboard, /getBackCapture/);
  assert.match(dashboard, /getDetailCaptures/);
  assert.match(dashboard, /MAX_PRODUCT_DETAIL_IMAGES/);
  assert.match(dashboard, /Detalle agregado/);
  assert.match(dashboard, /Subir detalles/);
  assert.match(dashboard, /Detalle \$\{index \+ 1\}/);
  assert.doesNotMatch(dashboard, /slice\(0,\s*3\)/);
  assert.match(dashboard, /Analizar y completar datos/);
  assert.match(dashboard, /Generar imágenes del producto/);
  assert.match(dashboard, /generateProductImagesWithGemini/);
  assert.match(dashboard, /commerce\/product-images/);
  assert.match(dashboard, /setCreation\(\(current\) =>/);
  assert.match(dashboard, /buildSpotSku/);
  assert.match(dashboard, /source:\s*"gemini_product_vision"/);
  assert.match(dashboard, /source_photos/);
  assert.match(dashboard, /generated_images/);
  assert.match(dashboard, /detail_index/);
  assert.match(dashboard, /display_label/);
  assert.match(dashboard, /cover_image/);
  assert.match(dashboard, /cover_url:\s*coverImage/);
  assert.match(scannerRoute, /upsert_commerce_scanned_product/);
  assert.match(scannerRoute, /commerce_products/);
  assert.match(scannerRoute, /cover_url/);
});

test("commerce product image generation reuses Gemini Image and all CLOUVA references", () => {
  assert.match(productImagesRoute, /requireUser/);
  assert.match(productImagesRoute, /requireManagedSpot/);
  assert.match(productImagesRoute, /generateImage/);
  assert.match(productImagesRoute, /uploadGeneratedMediaObject/);
  assert.match(productImagesRoute, /front_catalog/);
  assert.match(productImagesRoute, /back_catalog/);
  assert.match(productImagesRoute, /detail_catalog/);
  assert.match(productImagesRoute, /sourcePhotos/);
  assert.match(productImagesRoute, /generatedImages/);
  assert.match(productImagesRoute, /coverImage/);
  assert.match(productImagesRoute, /detailIndex/);
  assert.match(productImagesRoute, /displayLabel/);
  assert.match(productImagesRoute, /TODAS las referencias/);
});
