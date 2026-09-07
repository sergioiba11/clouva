import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import type { VisualCorrectionPatch } from "./visual-correction-patch";

export const REFERENCE_FIDELITY_MAX_ITERATIONS = 3;
export const REFERENCE_FIDELITY_TARGET_SCORE = 0.9;

export type ReferenceViewport = {
  width: number;
  height: number;
  aspectRatio: number;
};

export type ReferenceFidelityHistoryEntry = {
  iteration: number;
  scoreBefore: number | null;
  scoreAfter: number | null;
  model: string;
  costUsd: number;
  corrections: number;
  timestamp: string;
};

export type ReferenceFidelityState = {
  enabled: true;
  stage: string;
  versionId: string | null;
  referenceViewport: ReferenceViewport;
  iteration: number;
  maxIterations: number;
  visualScore: number | null;
  summary: string | null;
  structuralMismatch: boolean;
  pendingPatch: VisualCorrectionPatch | null;
  history: ReferenceFidelityHistoryEntry[];
  lastError: string | null;
};

function clampDimension(value: number) {
  return Math.max(240, Math.min(7680, Math.round(value)));
}

export function sanitizeReferenceViewport(value: unknown): ReferenceViewport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const width = typeof raw.width === "number" && Number.isFinite(raw.width) ? clampDimension(raw.width) : 0;
  const height = typeof raw.height === "number" && Number.isFinite(raw.height) ? clampDimension(raw.height) : 0;
  if (!width || !height) return null;
  return { width, height, aspectRatio: Number((width / height).toFixed(6)) };
}

function pngDimensions(buffer: Buffer): ReferenceViewport | null {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return sanitizeReferenceViewport({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });
}

function jpegDimensions(buffer: Buffer): ReferenceViewport | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return sanitizeReferenceViewport({ width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) });
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): ReferenceViewport | null {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = buffer.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return sanitizeReferenceViewport({ width, height });
  }
  if (kind === "VP8 " && buffer.length >= 30) {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return sanitizeReferenceViewport({ width, height });
  }
  if (kind === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21]; const b1 = buffer[22]; const b2 = buffer[23]; const b3 = buffer[24];
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 >> 6) | (b3 & 0xf0) << 2);
    return sanitizeReferenceViewport({ width, height });
  }
  return null;
}

export function inferReferenceViewport(image: GeminiReferenceImage | null | undefined): ReferenceViewport | null {
  if (!image?.data) return null;
  try {
    const buffer = Buffer.from(image.data, "base64");
    if (image.mimeType.includes("png")) return pngDimensions(buffer);
    if (image.mimeType.includes("jpeg") || image.mimeType.includes("jpg")) return jpegDimensions(buffer);
    if (image.mimeType.includes("webp")) return webpDimensions(buffer);
    return pngDimensions(buffer) ?? jpegDimensions(buffer) ?? webpDimensions(buffer);
  } catch {
    return null;
  }
}

export function createReferenceFidelityState(viewport: ReferenceViewport, versionId: string | null = null): ReferenceFidelityState {
  return {
    enabled: true,
    stage: "rendering_reference_preview",
    versionId,
    referenceViewport: viewport,
    iteration: 0,
    maxIterations: REFERENCE_FIDELITY_MAX_ITERATIONS,
    visualScore: null,
    summary: null,
    structuralMismatch: false,
    pendingPatch: null,
    history: [],
    lastError: null,
  };
}

export function readReferenceFidelityState(layoutAnalysis: unknown): ReferenceFidelityState | null {
  if (!layoutAnalysis || typeof layoutAnalysis !== "object") return null;
  const raw = (layoutAnalysis as Record<string, unknown>).referenceFidelity;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const viewport = sanitizeReferenceViewport(value.referenceViewport);
  if (!viewport || value.enabled !== true) return null;
  const history = Array.isArray(value.history) ? value.history.filter((item): item is ReferenceFidelityHistoryEntry => Boolean(item && typeof item === "object")).slice(-12) : [];
  return {
    enabled: true,
    stage: typeof value.stage === "string" ? value.stage.slice(0, 64) : "rendering_reference_preview",
    versionId: typeof value.versionId === "string" ? value.versionId : null,
    referenceViewport: viewport,
    iteration: typeof value.iteration === "number" ? Math.max(0, Math.min(10, Math.floor(value.iteration))) : 0,
    maxIterations: typeof value.maxIterations === "number" ? Math.max(1, Math.min(5, Math.floor(value.maxIterations))) : REFERENCE_FIDELITY_MAX_ITERATIONS,
    visualScore: typeof value.visualScore === "number" ? Math.max(0, Math.min(1, value.visualScore)) : null,
    summary: typeof value.summary === "string" ? value.summary.slice(0, 500) : null,
    structuralMismatch: value.structuralMismatch === true,
    pendingPatch: value.pendingPatch && typeof value.pendingPatch === "object" ? value.pendingPatch as VisualCorrectionPatch : null,
    history,
    lastError: typeof value.lastError === "string" ? value.lastError.slice(0, 500) : null,
  };
}

export function withReferenceFidelityState(layoutAnalysis: unknown, state: ReferenceFidelityState) {
  const base = layoutAnalysis && typeof layoutAnalysis === "object" ? layoutAnalysis as Record<string, unknown> : {};
  return { ...base, referenceFidelity: state };
}

function previewSecret() {
  const secret = process.env.VIP_PROFILE_TASK_SECRET?.trim();
  if (!secret) throw new Error("VIP_PROFILE_TASK_SECRET no está configurada.");
  return secret;
}

export function signReferencePreview(versionId: string) {
  return createHmac("sha256", previewSecret()).update(`reference-fidelity:${versionId}`).digest("hex");
}

export function verifyReferencePreview(versionId: string, token: string) {
  if (!/^[0-9a-f]{64}$/i.test(token)) return false;
  const expected = signReferencePreview(versionId);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token, "hex"));
}

function chromiumCommand() {
  return process.env.CLOUVA_CHROMIUM_PATH?.trim() || "/usr/bin/chromium";
}

async function runChromium(args: string[], timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(chromiumCommand(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Chromium excedió el tiempo máximo de captura."));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 2000); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Chromium no pudo capturar el preview (${code ?? "sin código"})${stderr ? `: ${stderr.slice(-800)}` : ""}`));
    });
  });
}

export async function captureReferencePreview(args: { versionId: string; viewport: ReferenceViewport }): Promise<GeminiReferenceImage> {
  const baseUrl = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
  const token = signReferencePreview(args.versionId);
  const url = `${baseUrl}/reference-fidelity/preview/${encodeURIComponent(args.versionId)}?token=${token}`;
  const directory = await mkdtemp(join(tmpdir(), "clouva-reference-fidelity-"));
  const screenshotPath = join(directory, "render.png");
  try {
    await runChromium([
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${args.viewport.width},${args.viewport.height}`,
      "--force-device-scale-factor=1",
      "--virtual-time-budget=3500",
      `--screenshot=${screenshotPath}`,
      url,
    ], 25_000);
    const bytes = await readFile(screenshotPath);
    if (!bytes.length) throw new Error("Chromium devolvió una captura vacía.");
    return { mimeType: "image/png", data: bytes.toString("base64") };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
