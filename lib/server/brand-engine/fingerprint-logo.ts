import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { LogoFingerprint } from "./types";

// Normalización determinista para comparar el mismo activo aunque haya sido
// recomprimido, reescalado o haya cambiado el contenedor de archivo.
export async function normalizeLogoBytes(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

// dHash de 64 bits. El campo histórico se mantiene como `phash` para no
// romper versiones existentes; `dhash` explicita qué algoritmo se usa hoy.
async function differenceHash(bytes: Buffer): Promise<string> {
  const { data } = await sharp(bytes)
    .flatten({ background: "#000000" })
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      bits += left < right ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export async function fingerprintLogo(bytes: Buffer): Promise<LogoFingerprint> {
  const normalized = await normalizeLogoBytes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const normalizedSha256 = createHash("sha256").update(normalized).digest("hex");
  const dhash = await differenceHash(normalized);
  return { sha256, normalizedSha256, phash: dhash, dhash };
}

export function hammingDistanceHex(a: string, b: string): number {
  const bigA = BigInt(`0x${a}`);
  const bigB = BigInt(`0x${b}`);
  let xor = bigA ^ bigB;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}
