import type { ScanAnalysis, Strain, VisualMatch } from "@/lib/genetics/types";

export type VisualFingerprint = {
  hue: number;
  saturation: number;
  lightness: number;
  greenRatio: number;
  warmRatio: number;
  edgeDensity: number;
};

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

async function sourceToBitmap(source: Blob | string) {
  if (typeof source === "string") {
    const response = await fetch(source, { cache: "force-cache" });
    if (!response.ok) throw new Error(`No se pudo leer ${source}`);
    return createImageBitmap(await response.blob());
  }
  return createImageBitmap(source);
}

export async function createVisualFingerprint(source: Blob | string): Promise<VisualFingerprint> {
  const bitmap = await sourceToBitmap(source);
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("El navegador no pudo preparar el análisis visual.");
  context.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  const { data } = context.getImageData(0, 0, size, size);

  let hueX = 0;
  let hueY = 0;
  let saturation = 0;
  let lightness = 0;
  let green = 0;
  let warm = 0;
  let samples = 0;
  const grays = new Float32Array(size * size);

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    if (data[i + 3] < 32) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const hsl = rgbToHsl(r, g, b);
    const radians = (hsl.h * Math.PI) / 180;
    hueX += Math.cos(radians) * hsl.s;
    hueY += Math.sin(radians) * hsl.s;
    saturation += hsl.s;
    lightness += hsl.l;
    if (hsl.h >= 70 && hsl.h <= 175 && hsl.s > 0.18) green += 1;
    if ((hsl.h <= 55 || hsl.h >= 340) && hsl.s > 0.22) warm += 1;
    grays[pixel] = r * 0.299 + g * 0.587 + b * 0.114;
    samples += 1;
  }

  let edges = 0;
  let edgeSamples = 0;
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const index = y * size + x;
      const delta = Math.abs(grays[index] - grays[index + 1]) + Math.abs(grays[index] - grays[index + size]);
      if (delta > 42) edges += 1;
      edgeSamples += 1;
    }
  }

  const angle = Math.atan2(hueY, hueX) * 180 / Math.PI;
  return {
    hue: angle < 0 ? angle + 360 : angle,
    saturation: samples ? saturation / samples : 0,
    lightness: samples ? lightness / samples : 0,
    greenRatio: samples ? green / samples : 0,
    warmRatio: samples ? warm / samples : 0,
    edgeDensity: edgeSamples ? edges / edgeSamples : 0,
  };
}

function circularHueDistance(a: number, b: number) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta) / 180;
}

function similarity(a: VisualFingerprint, b: VisualFingerprint) {
  const distance =
    circularHueDistance(a.hue, b.hue) * 0.18 +
    Math.abs(a.saturation - b.saturation) * 0.14 +
    Math.abs(a.lightness - b.lightness) * 0.12 +
    Math.abs(a.greenRatio - b.greenRatio) * 0.22 +
    Math.abs(a.warmRatio - b.warmRatio) * 0.16 +
    Math.abs(a.edgeDensity - b.edgeDensity) * 0.18;
  return Math.round(Math.max(0, Math.min(1, 1 - distance)) * 100);
}

function characteristics(fingerprint: VisualFingerprint) {
  const items: string[] = [];
  if (fingerprint.greenRatio >= 0.28) items.push("Predominio de tonos verdes");
  if (fingerprint.warmRatio >= 0.035) items.push("Acentos cálidos o anaranjados visibles");
  if (fingerprint.saturation >= 0.42) items.push("Coloración visualmente intensa");
  else if (fingerprint.saturation <= 0.22) items.push("Coloración visualmente suave");
  if (fingerprint.edgeDensity >= 0.28) items.push("Textura visual densa y de alto detalle");
  else items.push("Textura visual relativamente uniforme");
  if (fingerprint.lightness >= 0.58) items.push("Exposición general luminosa");
  else if (fingerprint.lightness <= 0.32) items.push("Exposición general oscura");
  return items.slice(0, 6);
}

export async function analyzeVisualSimilarity(file: File, strains: Strain[]): Promise<ScanAnalysis> {
  const target = await createVisualFingerprint(file);
  const matches: VisualMatch[] = [];

  for (const strain of strains) {
    if (!strain.hero_image) continue;
    try {
      const reference = await createVisualFingerprint(strain.hero_image);
      const score = similarity(target, reference);
      matches.push({
        slug: strain.slug,
        name: strain.name,
        similarity: score,
        rationale: ["Comparación de color, luminosidad y textura visual"],
      });
    } catch {
      // A remote image without CORS should not break the rest of the analysis.
    }
  }

  matches.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  return {
    visibleCharacteristics: characteristics(target),
    visualMatches: matches.slice(0, 5),
    notes: "La similitud es exclusivamente visual y no confirma identidad genética, composición ni efectos.",
  };
}
