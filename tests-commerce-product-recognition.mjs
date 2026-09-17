import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { sanitizeCommerceProductRecognition } from "./lib/commerce/product-recognition.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("./components/commerce/SpotCommerceDashboard.tsx");
const service = read("./lib/server/commerce-product-recognition.ts");
const vertexProvider = read("./lib/server/google-cloud-genai.ts");
const route = read("./app/api/studios/[slug]/commerce/recognize/route.ts");
const scannerRoute = read("./app/api/studios/[slug]/commerce/scan/route.ts");
const productImagesRoute = read("./app/api/studios/[slug]/commerce/product-images/route.ts");
const productImagesManagementRoute = read("./app/api/studios/[slug]/commerce/products/images/route.ts");
const publicationCopyRoute = read("./app/api/commerce/products/[id]/publication-copy/route.ts");
const publicationsRoute = read("./app/api/commerce/products/[id]/publications/route.ts");
const channelCapabilities = read("./lib/commerce/channel-capabilities.ts");
const captureContract = read("./lib/commerce/product-capture-contract.ts");
const deployWorkflow = read("./.github/workflows/deploy-gcp-web.yml");

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

test("visual scanner uses the canonical server-side Vertex AI provider with ADC", () => {
  assert.match(service, /generateGoogleCloudJson/);
  assert.doesNotMatch(service, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(service, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(service, /NEXT_PUBLIC_GEMINI/);
  assert.match(service, /provider:\s*"google_vertex_ai"/);
  assert.match(service, /Frente/);
  assert.match(service, /Atrás/);
  assert.match(service, /Detalle/);
  assert.match(service, /responseJsonSchema:\s*RESPONSE_SCHEMA/);
  assert.match(service, /MAX_PRODUCT_TOTAL_BYTES/);
  assert.match(vertexProvider, /GoogleGenAI/);
  assert.match(vertexProvider, /vertexai:\s*true/);
  assert.match(vertexProvider, /new Storage\(\)/);
  assert.match(vertexProvider, /getProjectId\(\)/);
  assert.doesNotMatch(vertexProvider, /NEXT_PUBLIC_/);
  assert.match(route, /requireManagedSpot/);
  assert.match(route, /recognizeCommerceProduct/);
  assert.match(route, /provider:\s*result\.provider/);
});

test("publication copy uses the same canonical Vertex AI provider", () => {
  assert.match(publicationCopyRoute, /generateGoogleCloudJson/);
  assert.match(publicationCopyRoute, /GOOGLE_CLOUD_PUBLICATION_COPY_MODEL/);
  assert.match(publicationCopyRoute, /provider:\s*generated\.provider/);
  assert.doesNotMatch(publicationCopyRoute, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(publicationCopyRoute, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(publicationCopyRoute, /NEXT_PUBLIC_/);
  assert.match(publicationsRoute, /copy_provider:\s*provider/);
  assert.match(publicationsRoute, /copy_model:\s*configuredModel/);
  assert.match(publicationsRoute, /GOOGLE_CLOUD_PUBLICATION_COPY_MODEL/);
});

test("publication backend enforces canonical channel capabilities", () => {
  assert.match(channelCapabilities, /clouva:[\s\S]*CLOUVA_INTERNAL_CAPABILITY/);
  assert.match(channelCapabilities, /clouva_market:[\s\S]*CLOUVA_INTERNAL_CAPABILITY/);
  assert.match(channelCapabilities, /canPublishAutomatically:\s*true/);
  assert.match(channelCapabilities, /facebook_marketplace:[\s\S]*canPublishAutomatically:\s*false/);
  assert.match(channelCapabilities, /facebook_group:[\s\S]*canPublishAutomatically:\s*false/);
  assert.match(channelCapabilities, /facebook_group:[\s\S]*requiresUserAction:\s*true/);
  assert.match(channelCapabilities, /Groups API and publish_to_groups on 2024-04-22/);
  assert.match(publicationsRoute, /publicationModeForChannel/);
  assert.match(publicationsRoute, /const mode = publicationModeForChannel\(channel, body\.publicationMode\)/);
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
  assert.match(dashboard, /commerce\/product-images/);
  assert.match(dashboard, /setCreation\(\(current\) =>/);
  assert.match(dashboard, /buildSpotSku/);
  assert.match(dashboard, /source_photos/);
  assert.match(dashboard, /generated_images/);
  assert.match(dashboard, /detail_index/);
  assert.match(dashboard, /display_label/);
  assert.match(dashboard, /cover_image/);
  assert.match(dashboard, /cover_url:\s*coverImage/);
  assert.match(scannerRoute, /canonicalRecognitionMetadata/);
  assert.match(scannerRoute, /google_cloud_product_recognition/);
  assert.match(scannerRoute, /google_vertex_ai/);
  assert.match(scannerRoute, /upsert_commerce_scanned_product/);
  assert.match(scannerRoute, /commerce_products/);
  assert.match(scannerRoute, /cover_url/);
});

test("commerce product image generation reuses Vertex AI and isolates each real catalog view", () => {
  assert.match(productImagesRoute, /requireUser/);
  assert.match(productImagesRoute, /requireManagedSpot/);
  assert.match(productImagesRoute, /generateGoogleCloudImage/);
  assert.doesNotMatch(productImagesRoute, /GEMINI_API_KEY/);
  assert.match(productImagesRoute, /uploadGeneratedMediaObject/);
  assert.match(productImagesRoute, /google_vertex_ai/);
  assert.match(productImagesRoute, /front_catalog/);
  assert.match(productImagesRoute, /back_catalog/);
  assert.doesNotMatch(productImagesRoute, /detail_catalog/);
  assert.match(productImagesRoute, /sourcePhotos/);
  assert.match(productImagesRoute, /generatedImages/);
  assert.match(productImagesRoute, /coverImage/);
  assert.match(productImagesRoute, /detailIndex/);
  assert.match(productImagesRoute, /displayLabel/);
  assert.match(productImagesRoute, /referencesForTarget/);
  assert.match(productImagesRoute, /referenceImages/);
  assert.match(productImagesRoute, /SOLO el producto/);
  assert.match(productImagesRoute, /Eliminá por completo manos, dedos, brazos/);
  assert.match(productImagesRoute, /referencias adicionales sirven SOLO como evidencia factual/);
  assert.match(productImagesRoute, /No inventes ilustraciones, palabras, símbolos, piezas, pestañas ni contenido/);
});

test("generated product images are not publication-approved until confirmed save", () => {
  assert.doesNotMatch(productImagesRoute, /publication_master/);
  assert.match(scannerRoute, /publication_master/);
  assert.match(scannerRoute, /approved:\s*true/);
  assert.match(scannerRoute, /approval_source:\s*"confirmed_product_save"/);
  assert.match(productImagesManagementRoute, /action === "set_publication"/);
  assert.match(productImagesManagementRoute, /approved:\s*hasApprovedMaster/);
  assert.match(productImagesManagementRoute, /approval_source:\s*"catalog_image_review"/);
  assert.match(publicationsRoute, /publicationMasterFromProduct/);
  assert.match(publicationsRoute, /PUBLICATION_MASTER_REQUIRED/);
  assert.match(publicationsRoute, /image_url:\s*publicationMaster\.coverUrl/);
  assert.match(publicationsRoute, /image_urls:\s*publicationMaster\.gallery/);
});

test("commerce product image generation has a coherent timeout budget", () => {
  assert.match(productImagesRoute, /maxDuration\s*=\s*300/);
  assert.match(productImagesRoute, /PRODUCT_IMAGE_GENERATION_TIMEOUT_MS\s*=\s*150_000/);
  assert.match(productImagesRoute, /Promise\.all\(targets\.map/);
  assert.doesNotMatch(productImagesRoute, /timeoutMs:\s*55_000/);
  assert.match(deployWorkflow, /--timeout 300/);
});
