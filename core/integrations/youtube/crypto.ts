import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getYoutubeConfig } from "./config";

export type YoutubeEncryptedSecret = { ciphertext: string; iv: string; authTag: string };

function key() {
  const raw = getYoutubeConfig().tokenEncryptionKey;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Explicit validation below.
  }
  throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY debe contener 32 bytes en base64 o 64 caracteres hexadecimales.");
}

export function encryptYoutubeSecret(value: string): YoutubeEncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptYoutubeSecret(secret: YoutubeEncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function youtubeSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
