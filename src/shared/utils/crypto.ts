import crypto from "crypto";
import { env } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const CURRENT_KEY_VERSION = "v1";

function getEncryptionKey(): Buffer {
  const rawKey = env.RESUME_ENCRYPTION_KEY;
  if (rawKey.length === 64) {
    return Buffer.from(rawKey, "hex");
  }
  return crypto.createHash("sha256").update(rawKey).digest();
}

export interface EncryptedPayload {
  cipherText: string;
  iv: string;
  tag: string;
  keyVersion?: string;
}

export function encryptText(text: string): { cipherText: string; iv: string; tag: string; keyVersion: string } {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return {
    cipherText: encrypted,
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptText(encryptedPayload: EncryptedPayload): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedPayload.iv, "base64");
  const authTag = Buffer.from(encryptedPayload.tag, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedPayload.cipherText, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function computeSha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
