import crypto from "crypto";
import { env } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const CURRENT_KEY_VERSION = "v1";

function getEncryptionKey() {
  const rawKey = env.RESUME_ENCRYPTION_KEY;
  // If 64 hex chars, convert from hex; if 32 chars utf8, convert from utf8
  if (rawKey.length === 64) {
    return Buffer.from(rawKey, "hex");
  }
  return crypto.createHash("sha256").update(rawKey).digest();
}

/**
 * Encrypt plaintext using AES-256-GCM with key versioning
 * @param {string} text - Plaintext to encrypt
 * @returns {{ cipherText: string, iv: string, tag: string, keyVersion: string }}
 */
export function encryptText(text) {
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

/**
 * Decrypt AES-256-GCM ciphertext
 * @param {{ cipherText: string, iv: string, tag: string, keyVersion?: string }} encryptedPayload
 * @returns {string} Plaintext
 */
export function decryptText(encryptedPayload) {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedPayload.iv, "base64");
  const authTag = Buffer.from(encryptedPayload.tag, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedPayload.cipherText, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Compute SHA256 hash of buffer or string
 */
export function computeSha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
