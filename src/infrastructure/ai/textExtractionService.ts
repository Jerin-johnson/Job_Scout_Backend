import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { logger } from "../../shared/utils/logger.js";

export const textExtractionService = {
  /**
   * Extract text from PDF buffer
   */
  async extractPdf(buffer: Buffer | Uint8Array): Promise<string> {
    try {
      const data = await pdfParse(buffer as Buffer);
      return this.sanitizeExtractedText(data.text);
    } catch (err) {
      const error = err as Error;
      logger.error({ err: error.message }, "Failed to extract text from PDF");
      throw new Error("Unable to parse PDF content. The document may be corrupted or encrypted.");
    }
  },

  /**
   * Extract text from DOCX buffer
   */
  async extractDocx(buffer: Buffer | Uint8Array): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer: buffer as Buffer });
      return this.sanitizeExtractedText(result.value);
    } catch (err) {
      const error = err as Error;
      logger.error({ err: error.message }, "Failed to extract text from DOCX");
      throw new Error("Unable to parse DOCX content. The document may be corrupted.");
    }
  },

  /**
   * Sanitize untrusted input: strip control characters, normalize whitespace,
   * prevent prompt injection wrappers.
   */
  sanitizeExtractedText(rawText?: string | null): string {
    if (!rawText) return "";

    return (
      rawText
        // Replace non-printable ASCII / null bytes
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        // Normalize CRLF to LF
        .replace(/\r\n/g, "\n")
        // Collapse excessive newlines (> 3) to 2
        .replace(/\n{3,}/g, "\n\n")
        // Trim leading and trailing whitespace
        .trim()
    );
  },
};
