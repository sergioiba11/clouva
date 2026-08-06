import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { reconstructLogoVector } from "./lib/server/brand-engine/vector-reconstruct.ts";
import { buildBrandKit } from "./lib/server/brand-engine/brand-kit.ts";
import { fingerprintLogo, normalizeLogoBytes } from "./lib/server/brand-engine/fingerprint-logo.ts";
import { normalizeBrandText, buildBrandSearchVariants } from "./lib/server/brand-engine/ip-clearance/normalize-brand-query.ts";
import { runInternalClearance } from "./lib/server/brand-engine/ip-clearance/internal-clearance.ts";
import { runBrandClearance } from "./lib/server/brand-engine/ip-clearance/classify-ip-risk.ts";

async function igluMockup() {
  const svg = `<svg width="1000" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="600" fill="#071526"/>
    <g transform="translate(300 120)" fill="#ffffff" stroke="#ffffff">
      <path d="M35 125 L105 35 L155 95 L215 20 L285 125 L265 125 L215 50 L157 122 L105 65 L55 125 Z" fill="none" stroke-width="8"/>
      <path d="M28 165 H52 V255 H28 Z M72 165 H98 V230 H155 V255 H72 Z M175 165 H200 V255 H175 Z M220 165 H246 L280 230 L314 165 H340 L294 255 H266 Z" stroke="none"/>
      <g transform="translate(75 280)" stroke="none"><rect x="0" y="0" width="18" height="38"/><rect x="35" y="0" width="18" height="38"/><rect x="70" y="0" width="18" height="38"/><rect x="105" y="0" width="18" height="38"/><rect x="140" y="0" width="18" height="38"/><rect x="175" y="0" width="18" height="38"/><rect x="210" y="0" width="18" height="38"/></g>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const IGLU_ANALYSIS = {
  detected: true,
  confidence: 1,
  primaryBox: { left: 260, top: 160, right: 660, bottom: 790 },
  occurrences: [],
  logoType: "combination",
  visibleText: { primaryName: "IGLÚ", descriptor: "RECORDS", otherText: [] },
  lockupStructure: { symbolPosition: "above", namePosition: "center", descriptorPosition: "below", orientation: "stacked", nameToDescriptorRatio: 2.5, symbolToWordmarkRatio: 1, letterSpacing: "very_wide" },
  visualSignature: { silhouette: "montañas lineales", geometry: "angular", symmetry: "parcial", strokeWeight: "medio", negativeSpace: "abierto", typographyStyle: "geométrica ancha", palette: ["#ffffff"], complexity: "minimal" },
  decomposition: {
    components: [
      { kind: "symbol", present: true, confidence: 1, box: { left: 20, top: 0, right: 760, bottom: 390 }, description: "montañas", expectedText: null },
      { kind: "wordmark", present: true, confidence: 1, box: { left: 0, top: 380, right: 900, bottom: 720 }, description: "wordmark", expectedText: "IGLÚ" },
      { kind: "descriptor", present: true, confidence: 1, box: { left: 90, top: 710, right: 800, bottom: 980 }, description: "descriptor", expectedText: "RECORDS" },
    ],
    foregroundPolarity: "light_on_dark",
    recommendedColorCount: 1,
    backgroundDescription: "azul oscuro",
  },
};

test("reconstrucción IGLÚ produce un SVG de paths, nunca una imagen raster embebida", async () => {
  const reconstruction = await reconstructLogoVector({ referenceBytes: await igluMockup(), detectedLogo: IGLU_ANALYSIS, params: { colorCount: 1, backgroundTolerance: 25, localContrastThreshold: 6, simplifyTolerance: 1 } });
  assert.match(reconstruction.masterSvg, /<path/);
  assert.doesNotMatch(reconstruction.masterSvg, /<image/i);
  assert.doesNotMatch(reconstruction.masterSvg, /data:image/i);
  assert.ok(reconstruction.symbolSvg?.includes("<path"));
  assert.ok(reconstruction.wordmarkSvg?.includes("<path"));
  assert.ok(reconstruction.descriptorSvg?.includes("<path"));
  assert.ok(reconstruction.validation.rasterSimilarity >= 0.68);
  assert.equal(reconstruction.validation.transparentBackground, true);
});

test("el recorte es referencia y la vista principal se deriva del SVG", async () => {
  const reconstruction = await reconstructLogoVector({ referenceBytes: await igluMockup(), detectedLogo: IGLU_ANALYSIS, params: { colorCount: 1 } });
  const rendered = await sharp(Buffer.from(reconstruction.masterSvg)).png().toBuffer();
  assert.equal((await sharp(rendered).metadata()).format, "png");
  assert.ok(!rendered.equals(reconstruction.sourceCropPng), "el logo oficial no puede ser el recorte del mockup");
});

test("Brand Kit nace del mismo SVG maestro", async () => {
  const reconstruction = await reconstructLogoVector({ referenceBytes: await igluMockup(), detectedLogo: IGLU_ANALYSIS, params: { colorCount: 1 } });
  const kit = await buildBrandKit({ reconstruction, naming: { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "user_confirmed" }, brandAssetId: "brand-1", versionId: "version-1", palette: ["#ffffff"] });
  assert.equal(kit.svgs.master, reconstruction.masterSvg);
  for (const svg of Object.values(kit.svgs)) { assert.match(svg, /<svg/); assert.doesNotMatch(svg, /<image/i); }
  for (const file of Object.values(kit.pngs)) assert.equal((await sharp(file.bytes).metadata()).format, "png");
  assert.equal(kit.printPdf.subarray(0, 4).toString(), "%PDF");
  const config = JSON.parse(kit.brandConfig.toString());
  assert.equal(config.display_name, "IGLÚ");
  assert.equal(config.descriptor, "RECORDS");
});

test("la reconstrucción es determinista con los mismos parámetros", async () => {
  const source = await igluMockup();
  const a = await reconstructLogoVector({ referenceBytes: source, detectedLogo: IGLU_ANALYSIS, params: { colorCount: 1, simplifyTolerance: 1.4 } });
  const b = await reconstructLogoVector({ referenceBytes: source, detectedLogo: IGLU_ANALYSIS, params: { colorCount: 1, simplifyTolerance: 1.4 } });
  assert.equal(a.masterSvg, b.masterSvg);
  assert.ok(a.previewPng.equals(b.previewPng));
});

test("fingerprint normalizado reconoce el mismo activo recomprimido", async () => {
  const original = await igluMockup();
  const recompressed = await sharp(original).png({ compressionLevel: 1 }).toBuffer();
  const a = await fingerprintLogo(original);
  const b = await fingerprintLogo(recompressed);
  assert.notEqual(a.sha256, b.sha256);
  assert.equal(a.normalizedSha256, b.normalizedSha256);
  assert.equal(a.dhash, b.dhash);
  assert.ok((await normalizeLogoBytes(original)).equals(await normalizeLogoBytes(recompressed)));
});

test("normalización de nombre genera variantes IGLÚ/IGLU/descriptor", () => {
  assert.equal(normalizeBrandText("Iglú Records"), "IGLU RECORDS");
  const variants = buildBrandSearchVariants("IGLÚ", "RECORDS");
  assert.ok(variants.includes("IGLÚ")); assert.ok(variants.includes("IGLU")); assert.ok(variants.includes("IGLU RECORDS"));
});

function internalAdmin(rows) {
  return { from(table) { assert.equal(table, "brand_asset_versions"); const chain = { select() { return chain; }, async in() { return { data: rows, error: null }; } }; return chain; } };
}

test("clearance interno bloquea hash idéntico de otro propietario", async () => {
  const fingerprint = await fingerprintLogo(await igluMockup());
  const result = await runInternalClearance({ admin: internalAdmin([{ id: "version-2", fingerprint, generation_metadata: { naming: { displayName: "OTRA", descriptor: null } }, brand_assets: { owner_type: "studio", owner_id: "otro" } }]), ownerType: "studio", ownerId: "iglu", fingerprint, naming: { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "user_confirmed" } });
  assert.equal(result.status, "internal_blocked_duplicate");
});

test("sin providers externos nunca inventa un clearance positivo", async () => {
  const fingerprint = await fingerprintLogo(await igluMockup());
  const clearance = await runBrandClearance({ admin: internalAdmin([]), ownerType: "studio", ownerId: "iglu", fingerprint, naming: { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "user_confirmed" }, imageBytes: await igluMockup(), categories: ["música"], country: "Argentina" });
  assert.equal(clearance.status, "external_check_unavailable");
  assert.equal(clearance.external.checked, false);
});
