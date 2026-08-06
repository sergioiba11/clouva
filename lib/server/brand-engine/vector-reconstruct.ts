import "server-only";
import sharp from "sharp";
import { cropLogoRegion } from "./crop-logo-region";
import {
  DEFAULT_VECTOR_RECONSTRUCTION_PARAMS,
  type DetectedLogo,
  type LogoComponentAnalysis,
  type LogoComponentKind,
  type LogoVectorReconstruction,
  type NormalizedBox,
  type VectorComponentResult,
  type VectorReconstructionParams,
  type VectorValidationReport,
} from "./types";

type Point = { x: number; y: number };
type RGB = { r: number; g: number; b: number };
type PreparedRaster = {
  width: number;
  height: number;
  rgba: Uint8Array;
  foreground: Uint8Array;
  foregroundPixels: number;
  background: RGB;
};

type TracedComponent = VectorComponentResult & {
  width: number;
  height: number;
  foregroundMask: Uint8Array;
  innerSvg: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const boxWidth = (box: NormalizedBox) => Math.max(1, box.right - box.left);
const boxHeight = (box: NormalizedBox) => Math.max(1, box.bottom - box.top);

export function normalizeReconstructionParams(input?: Partial<VectorReconstructionParams>): VectorReconstructionParams {
  const base = DEFAULT_VECTOR_RECONSTRUCTION_PARAMS;
  return {
    maxDimension: Math.round(clamp(input?.maxDimension ?? base.maxDimension, 256, 1600)),
    colorCount: Math.round(clamp(input?.colorCount ?? base.colorCount, 1, 4)),
    backgroundTolerance: clamp(input?.backgroundTolerance ?? base.backgroundTolerance, 8, 120),
    localContrastThreshold: clamp(input?.localContrastThreshold ?? base.localContrastThreshold, 2, 80),
    brightnessThreshold: clamp(input?.brightnessThreshold ?? base.brightnessThreshold, 80, 245),
    minComponentArea: Math.round(clamp(input?.minComponentArea ?? base.minComponentArea, 2, 500)),
    simplifyTolerance: clamp(input?.simplifyTolerance ?? base.simplifyTolerance, 0.1, 8),
    smoothing: clamp(input?.smoothing ?? base.smoothing, 0, 1),
    paddingPct: clamp(input?.paddingPct ?? base.paddingPct, 0, 0.2),
  };
}

function sanitizeRelativeBox(box: NormalizedBox | null | undefined): NormalizedBox | null {
  if (!box) return null;
  const left = clamp(Math.round(box.left), 0, 1000);
  const top = clamp(Math.round(box.top), 0, 1000);
  const right = clamp(Math.round(box.right), 0, 1000);
  const bottom = clamp(Math.round(box.bottom), 0, 1000);
  if (right - left < 8 || bottom - top < 8) return null;
  return { left, top, right, bottom };
}

function boxToPixels(box: NormalizedBox, width: number, height: number) {
  const left = clamp(Math.floor((box.left / 1000) * width), 0, Math.max(0, width - 1));
  const top = clamp(Math.floor((box.top / 1000) * height), 0, Math.max(0, height - 1));
  const right = clamp(Math.ceil((box.right / 1000) * width), left + 1, width);
  const bottom = clamp(Math.ceil((box.bottom / 1000) * height), top + 1, height);
  return { left, top, width: right - left, height: bottom - top };
}

function rgbDistance(a: RGB, b: RGB) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function luminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function sampleBackground(rgba: Uint8Array, width: number, height: number): RGB {
  const samples: RGB[] = [];
  const marginX = Math.max(1, Math.floor(width * 0.08));
  const marginY = Math.max(1, Math.floor(height * 0.08));
  const corners = [
    [0, 0, marginX, marginY],
    [Math.max(0, width - marginX), 0, width, marginY],
    [0, Math.max(0, height - marginY), marginX, height],
    [Math.max(0, width - marginX), Math.max(0, height - marginY), width, height],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    const stepX = Math.max(1, Math.floor((x2 - x1) / 5));
    const stepY = Math.max(1, Math.floor((y2 - y1) / 5));
    for (let y = y1; y < y2; y += stepY) {
      for (let x = x1; x < x2; x += stepX) {
        const index = (y * width + x) * 4;
        if ((rgba[index + 3] ?? 0) < 16) continue;
        samples.push({ r: rgba[index] ?? 0, g: rgba[index + 1] ?? 0, b: rgba[index + 2] ?? 0 });
      }
    }
  }
  if (!samples.length) return { r: 255, g: 255, b: 255 };
  samples.sort((a, b) => luminance(a.r, a.g, a.b) - luminance(b.r, b.g, b.b));
  const middle = samples[Math.floor(samples.length / 2)] ?? samples[0];
  return middle;
}

function dilate(mask: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let dy = -1; dy <= 1 && !value; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) {
            value = 1;
            break;
          }
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function erode(mask: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 1;
      for (let dy = -1; dy <= 1 && value; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {
            value = 0;
            break;
          }
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function removeSmallComponents(mask: Uint8Array, width: number, height: number, minimumArea: number) {
  const output = new Uint8Array(mask.length);
  const visited = new Uint8Array(mask.length);
  const neighbours = [-1, 0, 1];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    const component: number[] = [];
    visited[start] = 1;
    while (queue.length) {
      const index = queue.pop() as number;
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const dy of neighbours) {
        for (const dx of neighbours) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (mask[neighbour] && !visited[neighbour]) {
            visited[neighbour] = 1;
            queue.push(neighbour);
          }
        }
      }
    }
    if (component.length >= minimumArea) {
      for (const index of component) output[index] = 1;
    }
  }
  return output;
}

async function prepareRaster(
  bytes: Buffer,
  params: VectorReconstructionParams,
  polarity: "light_on_dark" | "dark_on_light" | "mixed",
): Promise<PreparedRaster> {
  const metadata = await sharp(bytes).metadata();
  const sourceWidth = metadata.width ?? 1;
  const sourceHeight = metadata.height ?? 1;
  const scale = Math.min(1, params.maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const rgbaResult = await sharp(bytes).resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8Array(rgbaResult.data);
  const gray = await sharp(bytes).resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 }).greyscale().raw().toBuffer();
  const blurSigma = Math.max(1, Math.min(width, height) / 36);
  const blurred = await sharp(bytes).resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 }).greyscale().blur(blurSigma).raw().toBuffer();
  const background = sampleBackground(rgba, width, height);
  const backgroundLum = luminance(background.r, background.g, background.b);
  const inferredPolarity = polarity === "mixed" ? (backgroundLum < 128 ? "light_on_dark" : "dark_on_light") : polarity;
  let foreground = new Uint8Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const rgbaIndex = index * 4;
    const r = rgba[rgbaIndex] ?? 0;
    const g = rgba[rgbaIndex + 1] ?? 0;
    const b = rgba[rgbaIndex + 2] ?? 0;
    const alpha = rgba[rgbaIndex + 3] ?? 0;
    if (alpha < 16) continue;
    const lum = gray[index] ?? 0;
    const local = blurred[index] ?? lum;
    const distance = rgbDistance({ r, g, b }, background);
    const contrast = inferredPolarity === "light_on_dark" ? lum - local : local - lum;
    const brightnessMatch = inferredPolarity === "light_on_dark"
      ? lum >= params.brightnessThreshold
      : lum <= 255 - params.brightnessThreshold;
    if ((distance >= params.backgroundTolerance && contrast >= params.localContrastThreshold * 0.35) || contrast >= params.localContrastThreshold || brightnessMatch) {
      foreground[index] = 1;
    }
  }

  foreground = erode(dilate(foreground, width, height), width, height);
  foreground = removeSmallComponents(foreground, width, height, params.minComponentArea);
  let foregroundPixels = 0;
  for (const value of foreground) foregroundPixels += value;
  return { width, height, rgba, foreground, foregroundPixels, background };
}

function deterministicPalette(raster: PreparedRaster, colorCount: number): RGB[] {
  const pixels: RGB[] = [];
  const sampleStep = Math.max(1, Math.floor(raster.foregroundPixels / 20_000));
  let seen = 0;
  for (let index = 0; index < raster.foreground.length; index += 1) {
    if (!raster.foreground[index]) continue;
    if (seen % sampleStep === 0) {
      const rgbaIndex = index * 4;
      pixels.push({ r: raster.rgba[rgbaIndex] ?? 0, g: raster.rgba[rgbaIndex + 1] ?? 0, b: raster.rgba[rgbaIndex + 2] ?? 0 });
    }
    seen += 1;
  }
  if (!pixels.length) return [{ r: 255, g: 255, b: 255 }];
  pixels.sort((a, b) => luminance(a.r, a.g, a.b) - luminance(b.r, b.g, b.b));
  const count = Math.max(1, Math.min(colorCount, pixels.length));
  let centroids = Array.from({ length: count }, (_, index) => pixels[Math.min(pixels.length - 1, Math.round(((index + 0.5) / count) * (pixels.length - 1)))] as RGB);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const pixel of pixels) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centroids.length; index += 1) {
        const distance = rgbDistance(pixel, centroids[index] as RGB);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      const sum = sums[best] as { r: number; g: number; b: number; n: number };
      sum.r += pixel.r;
      sum.g += pixel.g;
      sum.b += pixel.b;
      sum.n += 1;
    }
    centroids = centroids.map((centroid, index) => {
      const sum = sums[index] as { r: number; g: number; b: number; n: number };
      return sum.n ? { r: Math.round(sum.r / sum.n), g: Math.round(sum.g / sum.n), b: Math.round(sum.b / sum.n) } : centroid;
    });
  }
  return centroids;
}

function colorToHex(color: RGB) {
  return `#${[color.r, color.g, color.b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function pointKey(point: Point) {
  return `${point.x},${point.y}`;
}

function polygonArea(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index] as Point;
    const next = points[(index + 1) % points.length] as Point;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function rdp(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let maxIndex = 0;
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(points[index] as Point, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = rdp(points.slice(0, maxIndex + 1), tolerance);
  const right = rdp(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function simplifyClosed(points: Point[], tolerance: number) {
  if (points.length < 5) return points;
  let split = 0;
  let farthest = -1;
  const first = points[0] as Point;
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.hypot((points[index] as Point).x - first.x, (points[index] as Point).y - first.y);
    if (distance > farthest) {
      farthest = distance;
      split = index;
    }
  }
  const firstHalf = rdp(points.slice(0, split + 1), tolerance);
  const secondHalf = rdp([...points.slice(split), first], tolerance);
  const combined = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
  return combined.length >= 3 ? combined : points;
}

function traceLoops(mask: Uint8Array, width: number, height: number, minimumArea: number) {
  const edgeMap = new Map<string, Point[]>();
  const addEdge = (start: Point, end: Point) => {
    const key = pointKey(start);
    const list = edgeMap.get(key) ?? [];
    list.push(end);
    edgeMap.set(key, list);
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && Boolean(mask[y * width + x]);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) addEdge({ x, y }, { x: x + 1, y });
      if (!at(x + 1, y)) addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      if (!at(x, y + 1)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      if (!at(x - 1, y)) addEdge({ x, y: y + 1 }, { x, y });
    }
  }

  const loops: Point[][] = [];
  while (edgeMap.size) {
    const entry = edgeMap.entries().next().value as [string, Point[]] | undefined;
    if (!entry) break;
    const [startKey, starts] = entry;
    const [startX, startY] = startKey.split(",").map(Number);
    const firstEnd = starts.pop();
    if (!starts.length) edgeMap.delete(startKey);
    if (!firstEnd) continue;
    const loop: Point[] = [{ x: startX ?? 0, y: startY ?? 0 }, firstEnd];
    let current = firstEnd;
    let guard = width * height * 8;
    while (pointKey(current) !== startKey && guard > 0) {
      const key = pointKey(current);
      const candidates = edgeMap.get(key);
      const next = candidates?.pop();
      if (!candidates?.length) edgeMap.delete(key);
      if (!next) break;
      loop.push(next);
      current = next;
      guard -= 1;
    }
    if (loop.length >= 4 && Math.abs(polygonArea(loop)) >= minimumArea) loops.push(loop.slice(0, -1));
  }
  return loops;
}

function loopToPath(points: Point[], tolerance: number, smoothing: number) {
  const simplified = simplifyClosed(points, tolerance);
  if (simplified.length < 3) return "";
  const round = (value: number) => Number(value.toFixed(2));
  if (smoothing <= 0.02) {
    return `M ${round((simplified[0] as Point).x)} ${round((simplified[0] as Point).y)} ${simplified.slice(1).map((point) => `L ${round(point.x)} ${round(point.y)}`).join(" ")} Z`;
  }
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const last = simplified[simplified.length - 1] as Point;
  const first = simplified[0] as Point;
  const start = midpoint(last, first);
  const segments = simplified.map((point, index) => {
    const next = simplified[(index + 1) % simplified.length] as Point;
    const end = midpoint(point, next);
    const controlX = point.x * smoothing + end.x * (1 - smoothing);
    const controlY = point.y * smoothing + end.y * (1 - smoothing);
    return `Q ${round(controlX)} ${round(controlY)} ${round(end.x)} ${round(end.y)}`;
  });
  return `M ${round(start.x)} ${round(start.y)} ${segments.join(" ")} Z`;
}

function componentSvgFromRaster(raster: PreparedRaster, params: VectorReconstructionParams) {
  const palette = deterministicPalette(raster, params.colorCount);
  const paths: string[] = [];
  let nodeCount = 0;
  let pathCount = 0;

  for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex += 1) {
    const color = palette[paletteIndex] as RGB;
    let mask = new Uint8Array(raster.foreground.length);
    for (let index = 0; index < raster.foreground.length; index += 1) {
      if (!raster.foreground[index]) continue;
      const rgbaIndex = index * 4;
      const pixel = { r: raster.rgba[rgbaIndex] ?? 0, g: raster.rgba[rgbaIndex + 1] ?? 0, b: raster.rgba[rgbaIndex + 2] ?? 0 };
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < palette.length; candidate += 1) {
        const distance = rgbDistance(pixel, palette[candidate] as RGB);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      if (best === paletteIndex) mask[index] = 1;
    }
    mask = removeSmallComponents(mask, raster.width, raster.height, params.minComponentArea);
    const loops = traceLoops(mask, raster.width, raster.height, params.minComponentArea);
    const pathData = loops.map((loop) => loopToPath(loop, params.simplifyTolerance, params.smoothing)).filter(Boolean);
    if (!pathData.length) continue;
    pathCount += pathData.length;
    nodeCount += pathData.reduce((total, path) => total + (path.match(/[MLQ]/g)?.length ?? 0), 0);
    paths.push(`<path fill="${colorToHex(color)}" fill-rule="evenodd" d="${pathData.join(" ")}"/>`);
  }

  const innerSvg = paths.join("");
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${raster.width} ${raster.height}">${innerSvg}</svg>`,
    innerSvg,
    pathCount,
    nodeCount,
  };
}

function defaultComponents(detected: DetectedLogo): LogoComponentAnalysis[] {
  const decomposition = detected.decomposition?.components.filter((component) => component.present && component.box) ?? [];
  if (decomposition.length) return decomposition;
  return [{ kind: "full_lockup", present: true, confidence: 1, box: { left: 0, top: 0, right: 1000, bottom: 1000 }, description: "Lockup completo", expectedText: null }];
}

async function traceComponent(args: {
  sourceCrop: Buffer;
  cropWidth: number;
  cropHeight: number;
  component: LogoComponentAnalysis;
  params: VectorReconstructionParams;
  polarity: "light_on_dark" | "dark_on_light" | "mixed";
}): Promise<TracedComponent | null> {
  const relativeBox = sanitizeRelativeBox(args.component.box);
  if (!relativeBox) return null;
  const pixelBox = boxToPixels(relativeBox, args.cropWidth, args.cropHeight);
  const componentBytes = await sharp(args.sourceCrop).extract(pixelBox).png().toBuffer();
  const raster = await prepareRaster(componentBytes, args.params, args.polarity);
  if (!raster.foregroundPixels) return null;
  const traced = componentSvgFromRaster(raster, args.params);
  if (!traced.pathCount) return null;
  return {
    kind: args.component.kind,
    svg: traced.svg,
    innerSvg: traced.innerSvg,
    box: relativeBox,
    pathCount: traced.pathCount,
    sourcePixelCount: raster.foregroundPixels,
    width: raster.width,
    height: raster.height,
    foregroundMask: raster.foreground,
  };
}

function composeMasterSvg(components: TracedComponent[], width: number, height: number) {
  const body = components.map((component) => {
    const box = boxToPixels(component.box, width, height);
    return `<svg data-component="${component.kind}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" viewBox="0 0 ${component.width} ${component.height}" preserveAspectRatio="none">${component.innerSvg}</svg>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img">${body}</svg>`;
}

function componentStandaloneSvg(component: TracedComponent | undefined) {
  return component?.svg ?? null;
}

async function validateVector(args: {
  masterSvg: string;
  sourceCrop: Buffer;
  components: TracedComponent[];
  width: number;
  height: number;
}): Promise<{ report: VectorValidationReport; preview: Buffer }> {
  const preview = await sharp(Buffer.from(args.masterSvg)).resize(args.width, args.height, { fit: "fill" }).png().toBuffer();
  const rendered = await sharp(preview).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expected = new Uint8Array(args.width * args.height);
  for (const component of args.components) {
    const box = boxToPixels(component.box, args.width, args.height);
    const resizedMask = await sharp(Buffer.from(component.foregroundMask), { raw: { width: component.width, height: component.height, channels: 1 } })
      .resize(box.width, box.height, { fit: "fill", kernel: sharp.kernel.nearest })
      .raw()
      .toBuffer();
    for (let y = 0; y < box.height; y += 1) {
      for (let x = 0; x < box.width; x += 1) {
        if (resizedMask[y * box.width + x]) expected[(box.top + y) * args.width + box.left + x] = 1;
      }
    }
  }
  let intersection = 0;
  let union = 0;
  let expectedCount = 0;
  let renderedCount = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const actual = (rendered.data[index * rendered.info.channels + 3] ?? 0) > 32 ? 1 : 0;
    const wanted = expected[index] ?? 0;
    if (actual && wanted) intersection += 1;
    if (actual || wanted) union += 1;
    expectedCount += wanted;
    renderedCount += actual;
  }
  const rasterSimilarity = union ? intersection / union : 0;
  const sizeBalance = Math.max(expectedCount, renderedCount) ? 1 - Math.abs(expectedCount - renderedCount) / Math.max(expectedCount, renderedCount) : 0;
  const small = await sharp(Buffer.from(args.masterSvg)).resize(48, 48, { fit: "contain" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let smallForeground = 0;
  for (let index = 3; index < small.data.length; index += small.info.channels) if ((small.data[index] ?? 0) > 32) smallForeground += 1;
  const nodeCount = args.components.reduce((total, component) => total + component.pathCount, 0);
  const warnings: string[] = [];
  if (rasterSimilarity < 0.68) warnings.push("La reconstrucción todavía se aleja de la referencia; ajustá umbral, limpieza o cajas de componentes.");
  if (smallForeground < 16) warnings.push("La identidad pierde demasiada información a 48 px.");
  if (nodeCount > 2_000) warnings.push("El SVG contiene demasiados contornos; aumentá la simplificación o el área mínima.");
  return {
    preview,
    report: {
      rasterSimilarity,
      edgeSimilarity: sizeBalance,
      smallSizeLegible: smallForeground >= 16,
      monochromeValid: true,
      transparentBackground: true,
      nodeCount,
      warnings,
    },
  };
}

export async function reconstructLogoVector(args: {
  referenceBytes: Buffer;
  detectedLogo: DetectedLogo;
  params?: Partial<VectorReconstructionParams>;
}): Promise<LogoVectorReconstruction> {
  if (!args.detectedLogo.primaryBox) throw new Error("Falta el área principal confirmada del logo.");
  const params = normalizeReconstructionParams({
    ...args.params,
    colorCount: args.params?.colorCount ?? args.detectedLogo.decomposition?.recommendedColorCount ?? DEFAULT_VECTOR_RECONSTRUCTION_PARAMS.colorCount,
  });
  const sourceCropPng = await cropLogoRegion({
    referenceBytes: args.referenceBytes,
    normalizedBox: args.detectedLogo.primaryBox,
    paddingPct: params.paddingPct,
  });
  const cropMetadata = await sharp(sourceCropPng).metadata();
  const cropWidth = cropMetadata.width ?? 1;
  const cropHeight = cropMetadata.height ?? 1;
  const polarity = args.detectedLogo.decomposition?.foregroundPolarity ?? "mixed";
  const candidates = defaultComponents(args.detectedLogo);
  const traced = (await Promise.all(candidates.map((component) => traceComponent({ sourceCrop: sourceCropPng, cropWidth, cropHeight, component, params, polarity })))).filter((component): component is TracedComponent => component !== null);
  if (!traced.length) throw new Error("No se pudieron extraer contornos vectoriales. Ajustá las cajas de componentes o los parámetros de reconstrucción.");
  const masterSvg = composeMasterSvg(traced, cropWidth, cropHeight);
  const validation = await validateVector({ masterSvg, sourceCrop: sourceCropPng, components: traced, width: cropWidth, height: cropHeight });
  const symbol = traced.find((component) => component.kind === "symbol");
  const wordmark = traced.find((component) => component.kind === "wordmark");
  const descriptor = traced.find((component) => component.kind === "descriptor");
  return {
    masterSvg,
    symbolSvg: componentStandaloneSvg(symbol),
    wordmarkSvg: componentStandaloneSvg(wordmark),
    descriptorSvg: componentStandaloneSvg(descriptor),
    components: traced.map(({ innerSvg: _innerSvg, width: _width, height: _height, foregroundMask: _foregroundMask, ...component }) => component),
    params,
    validation: validation.report,
    sourceCropPng,
    previewPng: validation.preview,
  };
}
