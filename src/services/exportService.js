import PDFDocument from "pdfkit";
import { Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { storageService } from "./storageService.js";

export const exportService = {
  /**
   * Generate ATS-friendly PDF buffer
   */
  async generatePdf({ candidateName, email, jobTitle, company, bullets, summary }) {
    return new Promise((resolve) => {
      const doc = new PDFDocument({ margin: 50, pdfVersion: "1.5" });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      // Header
      doc.fontSize(20).font("Helvetica-Bold").text(candidateName || "Candidate", { align: "center" });
      if (email) {
        doc.fontSize(10).font("Helvetica").text(email, { align: "center" });
      }
      doc.moveDown(1.5);

      // Target Role
      doc.fontSize(14).font("Helvetica-Bold").text(`Tailored Application: ${jobTitle} at ${company}`);
      doc.moveDown(0.5);

      // Summary
      if (summary) {
        doc.fontSize(10).font("Helvetica").text(summary);
        doc.moveDown(1);
      }

      // Verified Experience Bullets
      doc.fontSize(12).font("Helvetica-Bold").text("Relevant Verified Experience:");
      doc.moveDown(0.5);

      for (const bullet of bullets) {
        doc.fontSize(10).font("Helvetica").text(`• ${bullet.tailoredBullet}`, { indent: 15 });
        doc.moveDown(0.2);
      }

      doc.end();
    });
  },

  /**
   * Generate ATS-friendly DOCX buffer
   */
  async generateDocx({ candidateName, email, jobTitle, company, bullets }) {
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
              text: `Target: ${jobTitle} at ${company}`,
              heading: HeadingLevel.HEADING_2,
            }),
            ...bullets.map(
              (b) =>
                new Paragraph({
                  children: [new TextRun({ text: `• ${b.tailoredBullet}` })],
                }),
            ),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  },

  /**
   * Export document to S3 and return signed/storage URLs
   */
  async exportAndUpload({ documentId, candidateName, email, jobTitle, company, bullets }) {
    const pdfBuffer = await this.generatePdf({ candidateName, email, jobTitle, company, bullets });
    const docxBuffer = await this.generateDocx({ candidateName, email, jobTitle, company, bullets });

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
