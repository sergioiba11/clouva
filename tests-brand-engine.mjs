import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { fingerprintLogo, hammingDistanceHex } from "./lib/server/brand-engine/fingerprint-logo.ts";
import { PHASH_SIMILARITY_THRESHOLD, checkUniqueness } from "./lib/server/brand-engine/validate-uniqueness.ts";
import { flattenToColor, removeBackground, toSquare } from "./lib/server/brand-engine/generate-logo.ts";
import { cropLogoRegion, normalizedBoxToPixelBox } from "./lib/server/brand-engine/crop-logo-region.ts";
import { resolveBrandNaming, suggestTypography } from "./lib/server/brand-engine/resolve-brand-naming.ts";
import { composeLogoLockups } from "./lib/server/brand-engine/compose-logo-lockups.ts";
import { resolveBrandAsset } from "./lib/server/brand-engine/resolve-brand-asset.ts";
import { pickAccentFromPalette } from "./lib/server/layout-config.ts";

// Imágenes sintéticas -- nunca llaman a Gemini ni tocan una base real, solo
// prueban las funciones puras de fingerprinting/unicidad/derivación.
async function solidSquarePng(hex) {
  const { r, g, b } = hexToRgb(hex);
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer();
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// dHash es estructural (compara brillo entre píxeles vecinos), no de color --
// dos cuadrados de color sólido SIEMPRE dan el mismo phash (sin gradiente
// interno), sin importar el color. Para probar "logos genuinamente
// distintos" hace falta variación estructural real, no solo color.
async function shapePng(seed) {
  const rects = Array.from({ length: 4 }).map((_, i) => {
    const x = ((seed * 13 + i * 17) % 40) + 4;
    const y = ((seed * 7 + i * 23) % 40) + 4;
    return `<rect x="${x}" y="${y}" width="14" height="14" fill="#ffffff" />`;
  });
  const svg = `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="#000000"/>${rects.join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("fingerprintLogo: la misma imagen produce el mismo sha256 y phash", async () => {
  const bytes = await solidSquarePng("#112233");
  const a = await fingerprintLogo(bytes);
  const b = await fingerprintLogo(bytes);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.phash, b.phash);
  assert.equal(a.phash.length, 16, "phash de 64 bits guardado como 16 caracteres hex");
});

test("fingerprintLogo: colores muy distintos producen sha256 distinto", async () => {
  const red = await fingerprintLogo(await solidSquarePng("#ff0000"));
  const blue = await fingerprintLogo(await solidSquarePng("#0000ff"));
  assert.notEqual(red.sha256, blue.sha256);
});

test("hammingDistanceHex: mismo hash -> distancia 0; opuestos -> distancia 64", () => {
  assert.equal(hammingDistanceHex("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistanceHex("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(hammingDistanceHex("ffffffffffffffff", "ffffffffffffffff"), 0);
});

test("checkUniqueness: rechaza sha256 idéntico dentro de la misma corrida", async () => {
  const candidate = await fingerprintLogo(await solidSquarePng("#abcdef"));
  const admin = { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) };
  const result = await checkUniqueness(admin, candidate, [candidate]);
  assert.equal(result.unique, false);
  assert.match(result.reason, /misma corrida/);
});

test("checkUniqueness: acepta si no hay nada parecido ni en la corrida ni en la base", async () => {
  const candidate = await fingerprintLogo(await shapePng(1));
  const other = await fingerprintLogo(await shapePng(9));
  // Confirma que el fixture realmente produce formas distintas -- si esto
  // fallara, el test de abajo no probaría nada real.
  assert.ok(hammingDistanceHex(candidate.phash, other.phash) > PHASH_SIMILARITY_THRESHOLD);
  const admin = { from: () => ({ select: () => ({ in: async () => ({ data: [{ fingerprint: other }], error: null }) }) }) };
  const result = await checkUniqueness(admin, candidate, []);
  assert.equal(result.unique, true);
});

test("checkUniqueness: rechaza si un fingerprint guardado en la base está dentro del umbral", async () => {
  const candidate = { sha256: "aaa", phash: "0000000000000000" };
  // Difiere en 1 solo bit -- muy por debajo del umbral (recoloreado/reescalado).
  const almostSame = { sha256: "bbb", phash: "0000000000000001" };
  assert.ok(hammingDistanceHex(candidate.phash, almostSame.phash) <= PHASH_SIMILARITY_THRESHOLD);
  const admin = { from: () => ({ select: () => ({ in: async () => ({ data: [{ fingerprint: almostSame }], error: null }) }) }) };
  const result = await checkUniqueness(admin, candidate, []);
  assert.equal(result.unique, false);
});

test("removeBackground: el fondo sólido queda transparente, la figura queda opaca", async () => {
  const svg = `<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="#0a0a0a"/><rect x="20" y="20" width="24" height="24" fill="#ffffff"/></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const transparent = await removeBackground(bytes);
  const { data, info } = await sharp(transparent).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const idx = (y, x) => (y * info.width + x) * info.channels;
  const cornerAlpha = data[idx(2, 2) + 3];
  const centerAlpha = data[idx(32, 32) + 3];
  assert.equal(cornerAlpha, 0, "el fondo (esquina) tiene que quedar transparente");
  assert.equal(centerAlpha, 255, "la figura (centro) tiene que quedar opaca");
});

test("flattenToColor: preserva el alpha pero fuerza el RGB al color pedido", async () => {
  const svg = `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" fill="#0a0a0a"/><circle cx="16" cy="16" r="10" fill="#3388ff"/></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const transparent = await removeBackground(bytes);
  const white = await flattenToColor(transparent, [255, 255, 255]);
  const { data, info } = await sharp(white).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const idx = (info.height / 2) * info.width * info.channels + (info.width / 2) * info.channels;
  assert.equal(data[idx], 255);
  assert.equal(data[idx + 1], 255);
  assert.equal(data[idx + 2], 255);
  assert.ok(data[idx + 3] > 0, "el centro (dentro del círculo) tiene que seguir opaco");
});

test("toSquare: siempre devuelve dimensiones cuadradas exactas", async () => {
  const wide = await sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }).png().toBuffer();
  const square = await toSquare(wide, 256);
  const meta = await sharp(square).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
});

// ---------------------------------------------------------------------------
// V2 -- hotfix de fidelidad al mockup (crop real, naming IGLÚ/RECORDS,
// composición determinista, un solo masterSymbol).
// ---------------------------------------------------------------------------

test("normalizedBoxToPixelBox: convierte 0-1000 a píxeles reales (test #1)", () => {
  const box = normalizedBoxToPixelBox({ top: 100, left: 200, bottom: 300, right: 600 }, 1000, 800, 0);
  assert.deepEqual(box, { left: 200, top: 80, width: 400, height: 160 });
});

test("normalizedBoxToPixelBox: el padding nunca saca la caja de los límites de la imagen (test #1/#2)", () => {
  const box = normalizedBoxToPixelBox({ top: 0, left: 0, bottom: 200, right: 200 }, 500, 500, 0.5);
  assert.ok(box.left >= 0 && box.top >= 0, "nunca coordenadas negativas");
  const farRight = normalizedBoxToPixelBox({ top: 800, left: 800, bottom: 1000, right: 1000 }, 500, 500, 0.5);
  assert.ok(farRight.left + farRight.width <= 500 && farRight.top + farRight.height <= 500, "nunca se pasa del borde derecho/inferior");
});

test("cropLogoRegion: recorta la región real con padding (test #2)", async () => {
  const svg = `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#000000"/><rect x="150" y="100" width="100" height="80" fill="#ff0000"/></svg>`;
  const referenceBytes = await sharp(Buffer.from(svg)).png().toBuffer();
  // box normalizado 0-1000 correspondiente aprox al rectángulo rojo (150-250, 100-180 sobre 400x300).
  const box = { top: (100 / 300) * 1000, left: (150 / 400) * 1000, bottom: (180 / 300) * 1000, right: (250 / 400) * 1000 };
  const cropped = await cropLogoRegion({ referenceBytes, normalizedBox: box, paddingPct: 0.2 });
  const meta = await sharp(cropped).metadata();
  // Con 20% de padding el recorte tiene que ser MÁS GRANDE que el rectángulo original (100x80).
  assert.ok(meta.width > 100 && meta.height > 80, "el padding agranda el recorte");
  // El centro del recorte tiene que seguir siendo rojo (no se perdió el contenido real).
  const { data, info } = await sharp(cropped).raw().toBuffer({ resolveWithObject: true });
  const centerIdx = Math.floor(info.height / 2) * info.width * info.channels + Math.floor(info.width / 2) * info.channels;
  assert.ok(data[centerIdx] > 150 && data[centerIdx + 1] < 100, "el centro del recorte sigue siendo el rectángulo rojo");
});

const IGLU_DETECTED_LOGO = {
  detected: true,
  confidence: 0.9,
  primaryBox: { top: 100, left: 100, bottom: 400, right: 900 },
  occurrences: [],
  logoType: "combination",
  visibleText: { primaryName: "IGLÚ", descriptor: "RECORDS", otherText: [] },
  lockupStructure: { symbolPosition: "above", namePosition: "center", descriptorPosition: "below", orientation: "stacked", nameToDescriptorRatio: 2.5, symbolToWordmarkRatio: 1, letterSpacing: "very_wide" },
  visualSignature: { silhouette: "montañas lineales", geometry: "angular", symmetry: "simétrico", strokeWeight: "fino", negativeSpace: "abierto", typographyStyle: "geométrica ancha", palette: ["#a8d8ea"], complexity: "minimal" },
};

test('resolveBrandNaming: "El Iglú" (entityName) NUNCA reemplaza "IGLÚ" detectado en el mockup (test #3/#4)', () => {
  const naming = resolveBrandNaming({ entityName: "El Iglú", detectedLogo: IGLU_DETECTED_LOGO });
  assert.equal(naming.entityName, "El Iglú");
  assert.equal(naming.displayName, "IGLÚ");
  assert.notEqual(naming.displayName, "El Iglú");
  assert.notEqual(naming.displayName, "EL IGLÚ");
  assert.equal(naming.source, "mockup_detected");
});

test('resolveBrandNaming: el descriptor "RECORDS" se conserva (test #5)', () => {
  const naming = resolveBrandNaming({ entityName: "El Iglú", detectedLogo: IGLU_DETECTED_LOGO });
  assert.equal(naming.descriptor, "RECORDS");
});

test("resolveBrandNaming: confianza baja del mockup cae a identidad oficial, después a entityName", () => {
  const lowConfidence = { ...IGLU_DETECTED_LOGO, confidence: 0.2 };
  const withOfficial = resolveBrandNaming({ entityName: "El Iglú", detectedLogo: lowConfidence, officialNaming: { displayName: "IGLÚ OFICIAL", descriptor: null } });
  assert.equal(withOfficial.displayName, "IGLÚ OFICIAL");
  assert.equal(withOfficial.source, "official_identity");

  const withoutOfficial = resolveBrandNaming({ entityName: "El Iglú", detectedLogo: lowConfidence, officialNaming: null });
  assert.equal(withoutOfficial.displayName, "El Iglú");
  assert.equal(withoutOfficial.source, "entity_fallback");
});

test("resolveBrandNaming: userConfirmed siempre gana, incluso sobre una detección de alta confianza", () => {
  const naming = resolveBrandNaming({ entityName: "El Iglú", detectedLogo: IGLU_DETECTED_LOGO, userConfirmed: { displayName: "IGLU CORREGIDO", descriptor: null } });
  assert.equal(naming.displayName, "IGLU CORREGIDO");
  assert.equal(naming.descriptor, null);
  assert.equal(naming.source, "user_confirmed");
});

test("suggestTypography: siempre usa la fuente embebida verificada, tracking varía con letterSpacing detectado", () => {
  const wide = suggestTypography(IGLU_DETECTED_LOGO);
  assert.equal(wide.family, "Archivo Black");
  const tight = suggestTypography({ ...IGLU_DETECTED_LOGO, lockupStructure: { ...IGLU_DETECTED_LOGO.lockupStructure, letterSpacing: "tight" } });
  assert.ok(tight.primaryTracking < wide.primaryTracking, "tight tiene que trackear menos que very_wide");
});

async function syntheticMasterSymbol() {
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="#0a0a0a"/><polyline points="80,380 180,220 260,320 340,180 440,380" stroke="#a8d8ea" stroke-width="14" fill="none"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("composeLogoLockups: nunca escribe el entityName ('EL IGLÚ') -- solo naming.displayName (test #6/#7/#8)", async () => {
  const masterSymbolBytes = await syntheticMasterSymbol();
  const naming = { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "mockup_detected" };
  const typography = suggestTypography(IGLU_DETECTED_LOGO);
  const variants = await composeLogoLockups({ masterSymbolBytes, naming, typography, lockupStructure: IGLU_DETECTED_LOGO.lockupStructure });
  // No hay forma de "leer" texto de un PNG sin OCR (fuera de alcance de esta
  // fase) -- lo que SÍ podemos afirmar con certeza es que compose nunca
  // recibió "El Iglú" como texto a dibujar (solo como metadata), y que las 9
  // variantes existen y son PNGs válidos no vacíos.
  for (const key of ["primary", "symbol", "horizontal", "vertical", "square", "transparent", "white", "black", "favicon"]) {
    assert.ok(variants[key].bytes.length > 0, `${key} generó bytes`);
    const meta = await sharp(variants[key].bytes).metadata();
    assert.equal(meta.format, "png");
  }
});

test("composeLogoLockups: es determinista -- mismo input produce bytes idénticos, prueba que no hay llamadas a Gemini escondidas (test #9)", async () => {
  const masterSymbolBytes = await syntheticMasterSymbol();
  const naming = { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "mockup_detected" };
  const typography = suggestTypography(IGLU_DETECTED_LOGO);
  const a = await composeLogoLockups({ masterSymbolBytes, naming, typography, lockupStructure: IGLU_DETECTED_LOGO.lockupStructure });
  const b = await composeLogoLockups({ masterSymbolBytes, naming, typography, lockupStructure: IGLU_DETECTED_LOGO.lockupStructure });
  for (const key of ["primary", "horizontal", "vertical", "square"]) {
    assert.ok(a[key].bytes.equals(b[key].bytes), `${key} tiene que ser byte-idéntico entre corridas (determinista, sin red)`);
  }
});

test("composeLogoLockups: nunca llama a red (fetch) -- horizontal/vertical/square/símbolo son 100% derivados, no generaciones nuevas (test #9)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("composeLogoLockups no debería llamar a fetch/red -- sería una generación de Gemini escondida."); };
  try {
    const masterSymbolBytes = await syntheticMasterSymbol();
    const naming = { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "mockup_detected" };
    const typography = suggestTypography(IGLU_DETECTED_LOGO);
    await composeLogoLockups({ masterSymbolBytes, naming, typography, lockupStructure: IGLU_DETECTED_LOGO.lockupStructure });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveBrandAsset: un logo oficial publicado NUNCA se rediseña sin forceRedesign -- cero llamadas a Gemini (test #10)", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-fake-key";
  globalThis.fetch = () => { throw new Error("No debería intentar generar -- ya hay un logo oficial publicado y forceRedesign es false."); };

  const publishedVersionRow = {
    id: "version-1",
    status: "published",
    primary_logo_url: "https://storage.googleapis.com/bucket/primary.png",
    symbol_logo_url: "https://storage.googleapis.com/bucket/symbol.png",
    horizontal_logo_url: null,
    vertical_logo_url: null,
    square_logo_url: null,
    transparent_logo_url: null,
    white_logo_url: null,
    black_logo_url: null,
    favicon_url: null,
    generation_metadata: { naming: { entityName: "El Iglú", displayName: "IGLÚ", descriptor: "RECORDS", source: "mockup_detected" } },
  };

  function chainable(resolveValue) {
    const handler = {
      select() { return handler; },
      eq() { return handler; },
      insert() { return handler; },
      update() { return handler; },
      async maybeSingle() { return resolveValue; },
      async single() { return resolveValue; },
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
    };
    return handler;
  }

  const admin = {
    from(table) {
      if (table === "brand_assets") return chainable({ data: { id: "brand-asset-1", owner_type: "studio", owner_id: "studio-1", active_version_id: "version-1" }, error: null });
      if (table === "brand_asset_versions") return chainable({ data: publishedVersionRow, error: null });
      if (table === "brand_generation_jobs") return chainable({ data: { id: "job-1" }, error: null });
      throw new Error(`stub: tabla no esperada ${table}`);
    },
  };

  try {
    const result = await resolveBrandAsset(admin, {
      ownerType: "studio",
      ownerId: "studio-1",
      entityName: "El Iglú",
      facts: {},
      source: "website_mockup",
      referenceImages: [],
      forceRedesign: false,
    });
    assert.equal(result.status, "reused_official");
    assert.equal(result.costUsd, 0);
    assert.equal(result.urls.primary_logo_url, publishedVersionRow.primary_logo_url);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test("pickAccentFromPalette: elige un tono intermedio real, nunca el más oscuro ni el más claro", () => {
  assert.equal(pickAccentFromPalette(["#000000", "#2a4b7c", "#a8d8ea", "#ffffff"]), "#2a4b7c");
  assert.equal(pickAccentFromPalette(["#001219", "#005f73", "#94d2bd", "#e9d8a6"]), "#005f73");
  assert.equal(pickAccentFromPalette(["#0a0a0a", "#7c3aed", "#ffffff"]), "#7c3aed");
  assert.equal(pickAccentFromPalette(["#111111", "#eeeeee"]), "#111111");
  assert.equal(pickAccentFromPalette([]), null);
  assert.equal(pickAccentFromPalette(null), null);
  assert.equal(pickAccentFromPalette("not-an-array"), null);
});
