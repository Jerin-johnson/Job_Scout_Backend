import PDFDocument from "pdfkit";
import { Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { storageService } from "./storageService.js";

export interface TailoredBulletItem {
  tailoredBullet?: string;
}

export interface GeneratePdfParams {
  candidateName?: string;
  email?: string;
  jobTitle?: string;
  company?: string;
  bullets?: TailoredBulletItem[] | unknown[];
  summary?: string;
}

export interface GenerateDocxParams {
  candidateName?: string;
  email?: string;
  jobTitle?: string;
  company?: string;
  bullets?: TailoredBulletItem[] | unknown[];
}

export interface ExportAndUploadParams {
  documentId: string;
  candidateName?: string;
  email?: string;
  jobTitle?: string;
  company?: string;
  bullets?: TailoredBulletItem[] | unknown[];
  summary?: string;
}

export interface ExportAndUploadResult {
  pdfUrl: string;
  docxUrl: string;
  pdfBuffer: Buffer;
  docxBuffer: Buffer;
}

export const exportService = {
  /**
   * Generate ATS-friendly PDF buffer
   */
  async generatePdf({
    candidateName,
    email,
    jobTitle,
    company,
    bullets,
    summary,
  }: GeneratePdfParams): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({ margin: 50, pdfVersion: "1.5" });
      const buffers: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      // Header
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(candidateName || "Candidate", { align: "center" });
      if (email) {
        doc.fontSize(10).font("Helvetica").text(email, { align: "center" });
      }
      doc.moveDown(1.5);

      // Target Role
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(`Tailored Application: ${jobTitle || ""} at ${company || ""}`);
      doc.moveDown(0.5);

      // Summary
      if (summary) {
        doc.fontSize(10).font("Helvetica").text(summary);
        doc.moveDown(1);
      }

      // Verified Experience Bullets
      doc.fontSize(12).font("Helvetica-Bold").text("Relevant Verified Experience:");
      doc.moveDown(0.5);

      for (const bullet of bullets || []) {
        const item = bullet as { tailoredBullet?: string };
        const text = item?.tailoredBullet || String(item || "");
        doc.fontSize(10).font("Helvetica").text(`• ${text}`, { indent: 15 });
        doc.moveDown(0.2);
      }

      doc.end();
    });
  },

  /**
   * Generate ATS-friendly DOCX buffer
   */
  async generateDocx({
    candidateName,
    email,
    jobTitle,
    company,
    bullets,
  }: GenerateDocxParams): Promise<Buffer> {
    const doc = new DocxDocument({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: candidateName || "Candidate",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              text: email || "",
            }),
            new Paragraph({
              text: `Target: ${jobTitle || ""} at ${company || ""}`,
              heading: HeadingLevel.HEADING_2,
            }),
            ...(bullets || []).map((b) => {
              const item = b as { tailoredBullet?: string };
              const text = item?.tailoredBullet || String(item || "");
              return new Paragraph({
                children: [new TextRun({ text: `• ${text}` })],
              });
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  },

  /**
   * Export document to S3 and return signed/storage URLs
   */
  async exportAndUpload({
    documentId,
    candidateName,
    email,
    jobTitle,
    company,
    bullets,
    summary,
  }: ExportAndUploadParams): Promise<ExportAndUploadResult> {
    const pdfBuffer = await this.generatePdf({
      candidateName,
      email,
      jobTitle,
      company,
      bullets,
      summary,
    });
    const docxBuffer = await this.generateDocx({
      candidateName,
      email,
      jobTitle,
      company,
      bullets,
    });

    const pdfKey = `exports/${documentId}/tailored_resume.pdf`;
    const docxKey = `exports/${documentId}/tailored_resume.docx`;

    const pdfUrl = await storageService.uploadFile({
      key: pdfKey,
      buffer: pdfBuffer,
      contentType: "application/pdf",
    });

    const docxUrl = await storageService.uploadFile({
      key: docxKey,
      buffer: docxBuffer,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    return { pdfUrl, docxUrl, pdfBuffer, docxBuffer };
  },
};
