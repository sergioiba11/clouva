import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type EncryptedSpotifySecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function getKey() {
  const raw = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("SPOTIFY_TOKEN_ENCRYPTION_KEY no está configurada.");
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("SPOTIFY_TOKEN_ENCRYPTION_KEY debe contener 32 bytes en base64 o 64 caracteres hexadecimales.");
}

export function encryptSpotifySecret(value: string): EncryptedSpotifySecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSpotifySecret(secret: EncryptedSpotifySecret) {
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function spotifySha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
