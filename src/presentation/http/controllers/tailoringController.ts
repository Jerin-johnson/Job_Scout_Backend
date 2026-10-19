import { Request, Response } from "express";
import { logger } from "../../../shared/utils/logger.js";
import { tailoringGraph } from "../../../ai/graphs/tailoringGraph.js";
import { exportService } from "../../../services/exportService.js";
import { profileRepository } from "../../../infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";
import { acceptRequestQuota } from "../middleware/quotaGate.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse } from "../../../shared/types/apiResponse.js";
import {
  startTailoringSchema,
  approveTailoringSchema,
  rejectTailoringSchema,
} from "../../../shared/schemas/tailoringSchemas.js";
import { documentStorageService, StoredDoc } from "../../../services/documentStorageService.js";

function getUserId(u?: UserRecord): string {
  if (!u) return "";
  return u._id
    ? u._id.toString()
    : (u as unknown as { id?: string }).id
      ? (u as unknown as { id?: string }).id!.toString()
      : "";
}

/**
 * POST /api/v1/tailor/start
 * Kick off the resume tailoring pipeline for a job.
 */
export const startTailor = asyncHandler(async (req: Request, res: Response) => {
  const { jobId, jobTitle, company, jdText } = startTailoringSchema.parse(req.body);
  const user = req.user as UserRecord;
  const userId = getUserId(user);

  // Load profile for facts
  const profile = await profileRepository.findByUserId(userId);
  if (!profile || (!profile.roles?.length && !profile.skills?.length)) {
    return res.status(400).json({
      error: {
        code: "NO_PROFILE_FACTS",
        message: "Upload and parse your resume first before tailoring.",
        requestId: req.id,
      },
    });
  }

  await acceptRequestQuota(req, "tailor_resume");

  interface TailoringResult {
    bullets: unknown[];
    summary: unknown;
    atsMatch?: { score?: number; covered?: string[] };
    requirements: unknown;
  }
  const result = (await tailoringGraph.runTailoring({
    user,
    profile,
    jobId,
    jobTitle,
    company,
    jdText,
  })) as TailoringResult;

  // Persist draft document
  const doc = await documentStorageService.saveDoc({
    userId,
    jobId,
    jobTitle,
    company,
    type: "tailored_resume",
    status: "awaiting_approval",
    tailoredBullets: result.bullets,
    atsMatchScore: result.atsMatch?.score || 0,
    atsKeywordsCovered: result.atsMatch?.covered || [],
  });

  logger.info({ userId, docId: doc._id, jobId }, "tailoring: draft created");

  return res.status(201).json(
    successResponse({
      documentId: doc._id,
      status: doc.status,
      jobTitle,
      company,
      bullets: result.bullets,
      summary: result.summary,
      atsMatch: result.atsMatch,
      requirements: result.requirements,
      message: "Draft created. Review bullets and approve or reject.",
    }),
  );
});

/**
 * POST /api/v1/tailor/:id/approve
 * Approve the draft (optionally with edits) and generate export files.
 */
export const approveTailor = asyncHandler(async (req: Request, res: Response) => {
  const doc = await documentStorageService.findDoc(String(req.params.id));
  if (!doc) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Document not found", requestId: req.id },
    });
  }
  const user = req.user as UserRecord;
  const userId = getUserId(user);
  if (doc.userId?.toString() !== userId) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Not your document", requestId: req.id },
    });
  }
  if (doc.status === "approved") {
    return res.status(200).json(
      successResponse({
        documentId: doc._id,
        status: doc.status,
        pdfUrl: doc.pdfStorageUrl,
        docxUrl: doc.docxStorageUrl,
        message: "Already approved.",
      }),
    );
  }

  const { editedBullets } = approveTailoringSchema.parse(req.body);

  interface BulletItem {
    factId?: string;
    tailoredBullet?: string;
    [key: string]: unknown;
  }

  const finalBullets =
    editedBullets && editedBullets.length
      ? editedBullets.map((eb: { factId: string; tailoredBullet: string }) => ({
          ...((doc.tailoredBullets as BulletItem[]) || []).find((b) => b.factId === eb.factId),
          tailoredBullet: eb.tailoredBullet,
        }))
      : doc.tailoredBullets;

  const exportResult = (await exportService.exportAndUpload({
    documentId: doc._id,
    candidateName: user.name || "Candidate",
    email: user.email,
    jobTitle: doc.jobTitle,
    company: doc.company,
    bullets: finalBullets,
  })) as { pdfUrl: string; docxUrl: string };

  const updated = (await documentStorageService.updateDoc(doc._id, {
    status: "approved",
    tailoredBullets: finalBullets as unknown[],
    pdfStorageUrl: exportResult.pdfUrl,
    docxStorageUrl: exportResult.docxUrl,
    approvedAt: new Date(),
  })) as StoredDoc;

  logger.info({ userId, docId: doc._id }, "tailoring: approved and exported");

  return res.status(200).json(
    successResponse({
      documentId: updated._id,
      status: updated.status,
      pdfUrl: updated.pdfStorageUrl,
      docxUrl: updated.docxStorageUrl,
      approvedAt: updated.approvedAt,
      message: "Document approved and exported successfully.",
    }),
  );
});

/**
 * POST /api/v1/tailor/:id/reject
 * Reject the draft.
 */
export const rejectTailor = asyncHandler(async (req: Request, res: Response) => {
  const doc = await documentStorageService.findDoc(String(req.params.id));
  if (!doc) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Document not found", requestId: req.id },
    });
  }
  const user = req.user as UserRecord;
  const userId = getUserId(user);
  if (doc.userId?.toString() !== userId) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Not your document", requestId: req.id },
    });
  }

  const { reason } = rejectTailoringSchema.parse(req.body || {});
  const updated = (await documentStorageService.updateDoc(doc._id, {
    status: "rejected",
  })) as StoredDoc;

  logger.info({ userId, docId: doc._id, reason }, "tailoring: rejected");

  return res
    .status(200)
    .json(successResponse({ documentId: updated._id, status: updated.status, reason }));
});

/**
 * GET /api/v1/tailor/:id
 * Get document status and draft.
 */
export const getTailoringDoc = asyncHandler(async (req: Request, res: Response) => {
  const doc = await documentStorageService.findDoc(String(req.params.id));
  if (!doc) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Document not found", requestId: req.id },
    });
  }
  const user = req.user as UserRecord;
  const userId = getUserId(user);
  if (doc.userId?.toString() !== userId) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Not your document", requestId: req.id },
    });
  }
  return res.status(200).json(successResponse({ document: doc }));
});

/**
 * GET /api/v1/tailor/:id/export?format=pdf|docx
 * Download exported file directly as binary.
 */
export const exportDocument = asyncHandler(async (req: Request, res: Response) => {
  const doc = await documentStorageService.findDoc(String(req.params.id));
  if (!doc) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Document not found", requestId: req.id },
    });
  }
  const user = req.user as UserRecord;
  const userId = getUserId(user);
  if (doc.userId?.toString() !== userId) {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Not your document", requestId: req.id },
    });
  }

  const format = req.query.format === "docx" ? "docx" : "pdf";
  const bullets = doc.tailoredBullets || [];

  if (format === "pdf") {
    const pdfBuffer = (await exportService.generatePdf({
      candidateName: user.name || "Candidate",
      email: user.email,
      jobTitle: doc.jobTitle,
      company: doc.company,
      bullets,
      summary: "",
    })) as Buffer;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="tailored_resume_${doc._id}.pdf"`);
    return res.send(pdfBuffer);
  } else {
    const docxBuffer = (await exportService.generateDocx({
      candidateName: user.name || "Candidate",
      email: user.email,
      jobTitle: doc.jobTitle,
      company: doc.company,
      bullets,
    })) as Buffer;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="tailored_resume_${doc._id}.docx"`);
    return res.send(docxBuffer);
  }
});

/**
 * GET /api/v1/tailor
 * List all tailored documents for the authenticated user.
 */
export const listTailoringDocs = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as UserRecord;
  const userId = getUserId(user);
  const docs = await documentStorageService.listDocs(userId);
  return res.status(200).json(successResponse({ documents: docs, count: docs.length }));
});

export const tailoringController = {
  startTailor,
  approveTailor,
  rejectTailor,
  getTailoringDoc,
  exportDocument,
  listTailoringDocs,
};
