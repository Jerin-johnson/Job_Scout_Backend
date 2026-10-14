export function validateResumeMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) {
    return { valid: false, mimeType: null, error: "File buffer is too small or empty" };
  }

  // PDF Magic Bytes: %PDF- (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { valid: true, mimeType: "application/pdf" };
  }

  // DOCX (Zip archive) Magic Bytes: PK\x03\x04 (0x50 0x4b 0x03 0x04)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return {
      valid: true,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  return {
    valid: false,
    mimeType: null,
    error: "Invalid file type. Only authentic PDF or DOCX documents are accepted.",
  };
}

/**
 * SSRF Guard: Blocks attempts to query private or link-local networks
 */
export function isPrivateIp(ipOrHost) {
  if (!ipOrHost) return true;

  const blockedPatterns = [
    /^localhost$/i,
    /^127\./, // 127.0.0.0/8
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^169\.254\./, // 169.254.0.0/16
    /^::1$/, // IPv6 loopback
    /^fc00:/, // IPv6 unique local
    /^fe80:/, // IPv6 link-local
  ];

  return blockedPatterns.some((pattern) => pattern.test(ipOrHost));
}
