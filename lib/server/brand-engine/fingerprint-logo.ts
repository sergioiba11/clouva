import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { LogoFingerprint } from "./types";

// dHash (difference hash) de 64 bits: reduce la imagen a una grilla 9x8 en
// grises, compara cada píxel contra su vecino de la derecha (más claro =
// bit 1) -- 8 filas x 8 comparaciones = 64 bits. Tolera compresión/reescalado
// y cambios chicos de color (no es exacto como sha256, es "se ve casi
// igual"), que es justo lo que hace falta para el punto 8 del pedido:
// detectar la MISMA imagen recoloreada/escalada/levemente modificada.
async function perceptualHash(bytes: Buffer): Promise<string> {
  const { data } = await sharp(bytes)
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
  // Guardado como hex (16 caracteres) -- más compacto que el string binario,
  // misma información.
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export async function fingerprintLogo(bytes: Buffer): Promise<LogoFingerprint> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const phash = await perceptualHash(bytes);
  return { sha256, phash };
}

// Hamming distance entre dos phash hex de 64 bits -- cuántos bits difieren.
// 0 = idénticos, 64 = opuestos. Umbral de "demasiado parecido" vive en
// validate-uniqueness.ts (a calibrar con casos reales, ver plan).
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
