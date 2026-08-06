import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { importRealBrandAsset } from "./lib/server/brand-engine/import-real-brand-asset.ts";
import { fingerprintLogo, normalizeLogoBytes } from "./lib/server/brand-engine/fingerprint-logo.ts";
import { normalizeBrandText, buildBrandSearchVariants } from "./lib/server/brand-engine/ip-clearance/normalize-brand-query.ts";
import { runInternalClearance } from "./lib/server/brand-engine/ip-clearance/internal-clearance.ts";
import { runBrandClearance } from "./lib/server/brand-engine/ip-clearance/classify-ip-risk.ts";

async function igluMockup() {
  const svg = `<svg width="1000" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="600" fill="#071526"/>
    <g transform="translate(300 150)">
      <polyline points="40,110 100,35 150,90 205,20 270,110" fill="none" stroke="#ffffff" stroke-width="8"/>
      <text x="20" y="190" font-size="72" font-family="sans-serif" font-weight="700" fill="#ffffff">IGLÚ</text>
      <text x="55" y="235" font-size="24" font-family="sans-serif" letter-spacing="12" fill="#ffffff">RECORDS</text>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("importRealBrandAsset conserva el recorte real y no llama a red/Gemini", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("La importación real no debe llamar a red ni a Gemini"); };
  try {
    const referenceBytes = await igluMockup();
    const imported = await importRealBrandAsset({
      referenceBytes,
      sourceImageUrl: "https://storage.googleapis.com/example/iglu.png",
      sourceBox: { left: 280, top: 210, right: 610, bottom: 690 },
      extractionMethod: "manual_crop",
    });
    assert.ok(imported.master.originalBytes.length > 0);
    assert.ok(imported.master.cleanedBytes.length > 0);
    assert.equal(imported.master.sourceImageUrl, "https://storage.googleapis.com/example/iglu.png");
    assert.equal(imported.master.extractionMethod, "manual_crop");
    assert.equal(imported.parts.standaloneSymbol, null, "no inventa un símbolo independiente");
    for (const key of ["primary", "symbol", "horizontal", "vertical", "square", "transparent", "white", "black", "favicon"]) {
      const meta = await sharp(imported.variants[key].bytes).metadata();
      assert.equal(meta.format, "png", `${key} deriva del activo real como PNG`);
    }
    assert.ok(imported.variants.primary.bytes.equals(imported.master.originalBytes), "primary es el lockup real, no una recomposición");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("importRealBrandAsset no deforma el lockup al crear variantes técnicas", async () => {
  const imported = await importRealBrandAsset({
    referenceBytes: await igluMockup(),
    sourceBox: { left: 280, top: 210, right: 610, bottom: 690 },
    extractionMethod: "confirmed_detected_crop",
  });
  const originalMeta = await sharp(imported.master.originalBytes).metadata();
  const horizontalMeta = await sharp(imported.variants.horizontal.bytes).metadata();
  const verticalMeta = await sharp(imported.variants.vertical.bytes).metadata();
  assert.ok((originalMeta.width ?? 0) > 0 && (originalMeta.height ?? 0) > 0);
  assert.equal(horizontalMeta.width, 1600);
  assert.equal(horizontalMeta.height, 600);
  assert.equal(verticalMeta.width, 800);
  assert.equal(verticalMeta.height, 1200);
});

test("fingerprint normalizado reconoce el mismo activo recomprimido", async () => {
  const original = await igluMockup();
  const recompressed = await sharp(original).png({ compressionLevel: 1 }).toBuffer();
  const a = await fingerprintLogo(original);
  const b = await fingerprintLogo(recompressed);
  assert.notEqual(a.sha256, b.sha256, "el hash original puede cambiar con la compresión");
  assert.equal(a.normalizedSha256, b.normalizedSha256, "el hash normalizado conserva la identidad visual exacta");
  assert.equal(a.dhash, b.dhash);
  assert.ok((await normalizeLogoBytes(original)).equals(await normalizeLogoBytes(recompressed)));
});

test("normalización de nombre genera variantes IGLÚ/IGLU/descriptor", () => {
  assert.equal(normalizeBrandText("Iglú Records"), "IGLU RECORDS");
  const variants = buildBrandSearchVariants("IGLÚ", "RECORDS");
  assert.ok(variants.includes("IGLÚ"));
  assert.ok(variants.includes("IGLU"));
  assert.ok(variants.includes("IGLU RECORDS"));
  assert.ok(variants.includes("EL IGLU"));
});

function internalAdmin(rows) {
  return {
    from(table) {
      assert.equal(table, "brand_asset_versions");
      const chain = {
        select() { return chain; },
        async in() { return { data: rows, error: null }; },
      };
      return chain;
    },
  };
}

test("clearance interno bloquea hash idéntico de otro propietario", async () => {
  const fingerprint = await fingerprintLogo(await igluMockup());
  const result = await runInternalClearance({
    admin: internalAdmin([{ id: "version-2", fingerprint, generation_metadata: { naming: { displayName: "OTRA", descriptor: null } }, brand_assets: { owner_type: "studio", owner_id: "otro" } }]),
    ownerType: "studio",
    ownerId: "iglu",
    fingerprint,
    naming: { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "user_confirmed" },
  });
  assert.equal(result.status, "internal_blocked_duplicate");
  assert.equal(result.conflictingOwnerId, "otro");
});

test("clearance interno excluye versiones del mismo propietario", async () => {
  const fingerprint = await fingerprintLogo(await igluMockup());
  const result = await runInternalClearance({
    admin: internalAdmin([{ id: "version-old", fingerprint, generation_metadata: { naming: { displayName: "IGLÚ", descriptor: "RECORDS" } }, brand_assets: { owner_type: "studio", owner_id: "iglu" } }]),
    ownerType: "studio",
    ownerId: "iglu",
    fingerprint,
    naming: { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "user_confirmed" },
  });
  assert.equal(result.status, "internal_clear");
});

test("sin providers externos nunca devuelve clear", async () => {
  const fingerprint = await fingerprintLogo(await igluMockup());
  const clearance = await runBrandClearance({
    admin: internalAdmin([]),
    ownerType: "studio",
    ownerId: "iglu",
    fingerprint,
    naming: { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "user_confirmed" },
    imageBytes: await igluMockup(),
    categories: ["música", "estudio"],
    country: "Argentina",
  });
  assert.equal(clearance.status, "external_check_unavailable");
  assert.equal(clearance.external.checked, false);
  assert.deepEqual(clearance.external.sourcesChecked, []);
});
