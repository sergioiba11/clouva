import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getFacebookConfig } from "./config";

export type FacebookEncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
};

function encryptionKey() {
  const raw = getFacebookConfig().tokenEncryptionKey;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Validation below.
  }
  throw new Error("FACEBOOK_TOKEN_ENCRYPTION_KEY debe contener 32 bytes en base64 o 64 caracteres hexadecimales.");
}

export function encryptFacebookSecret(value: string): FacebookEncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: getFacebookConfig().tokenKeyVersion,
  };
}

export function decryptFacebookSecret(secret: FacebookEncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function facebookSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
