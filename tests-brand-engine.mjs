import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { fingerprintLogo, hammingDistanceHex } from "./lib/server/brand-engine/fingerprint-logo.ts";
import { PHASH_SIMILARITY_THRESHOLD, checkUniqueness } from "./lib/server/brand-engine/validate-uniqueness.ts";
import { flattenToColor, removeBackground, toSquare } from "./lib/server/brand-engine/generate-logo.ts";
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

test("pickAccentFromPalette: elige un tono intermedio real, nunca el más oscuro ni el más claro", () => {
  assert.equal(pickAccentFromPalette(["#000000", "#2a4b7c", "#a8d8ea", "#ffffff"]), "#2a4b7c");
  assert.equal(pickAccentFromPalette(["#001219", "#005f73", "#94d2bd", "#e9d8a6"]), "#005f73");
  assert.equal(pickAccentFromPalette(["#0a0a0a", "#7c3aed", "#ffffff"]), "#7c3aed");
  assert.equal(pickAccentFromPalette(["#111111", "#eeeeee"]), "#111111");
  assert.equal(pickAccentFromPalette([]), null);
  assert.equal(pickAccentFromPalette(null), null);
  assert.equal(pickAccentFromPalette("not-an-array"), null);
});
