// Generic AES-256-GCM secret box — parameterized by which env var holds the
// key, so a new secret (like workspace_links' device token) doesn't need a
// second hand-copied implementation of the same algorithm. Deliberately NOT
// a rewrite of core/integrations/instagram/crypto.ts, which stays exactly
// as it is (working, already tested, tied to its own
// INSTAGRAM_TOKEN_ENCRYPTION_KEY) — this is the same proven pattern
// (aes-256-gcm, 12-byte iv, base64 columns), pulled out so a *different*
// secret gets its *own* key (a leaked/rotated Workspace-pairing key should
// never imply anything about Instagram tokens, or vice versa), not a shared
// one. If a third secret needs this shape later, it reuses this file
// too — Instagram's is simply left alone rather than migrated for its own
// sake.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function loadKey(envVarName: string): Buffer {
  const raw = process.env[envVarName]?.trim();
    if (!raw) throw new Error(`Falta ${envVarName} en el servicio de Cloud Run.`);

  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Falls through to the explicit validation error below.
  }

  throw new Error(`${envVarName} debe contener 32 bytes en base64 o 64 caracteres hexadecimales.`);
}

/** Binds a key (identified by env var name, never the raw value) once, so
 * callers write `encrypt(value)` / `decrypt(secret)` instead of threading
 * the env var name through every call site. */
export function createSecretBox(envVarName: string) {
  return {
    encrypt(value: string): EncryptedSecret {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", loadKey(envVarName), iv);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return {
        ciphertext: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
      };
    },
    decrypt(secret: EncryptedSecret): string {
      const decipher = createDecipheriv("aes-256-gcm", loadKey(envVarName), Buffer.from(secret.iv, "base64"));
      decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}

// Task 9 (the Cloud Run pairing route) and Task 10 (WorkspaceExecutor) both
// need to encrypt/decrypt the same workspace_links device token — one
// shared box, one shared key, instead of each re-deriving it from the env
// var name by hand.
export const workspaceDeviceTokenBox = createSecretBox("WORKSPACE_DEVICE_TOKEN_ENCRYPTION_KEY");
