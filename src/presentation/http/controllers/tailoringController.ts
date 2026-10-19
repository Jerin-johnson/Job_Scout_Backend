import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { logger } from "../../../shared/utils/logger.js";
import { tailoringGraph } from "../../../ai/graphs/tailoringGraph.js";
import { exportService } from "../../../services/exportService.js";
import { Document } from "../../../infrastructure/database/mongoose/models/DocumentModel.js";
import { profileRepository } from "../../../infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";
import mongoose from "mongoose";
import { acceptRequestQuota } from "../middleware/quotaGate.js";
import { UserRecord } from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";

interface StoredDoc {
  _id: string;
  userId?: string;
  jobId?: string;
  jobTitle?: string;
  company?: string;
  type?: string;
  status?: string;
  tailoredBullets?: unknown[];
  atsMatchScore?: number;
  atsKeywordsCovered?: string[];
  pdfStorageUrl?: string;
  docxStorageUrl?: string;
  approvedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

// ── In-memory document store for offline/test mode ──────────────────────────
const inMemoryDocs = new Map<string, StoredDoc>();
let docCounter = 1;

function isMongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}

function getUserId(u?: UserRecord): string {
  if (!u) return "";
  return u._id
    ? u._id.toString()
    : (u as unknown as { id?: string }).id
      ? (u as unknown as { id?: string }).id!.toString()
      : "";
}

// ── Zod Schemas ──────────────────────────────────────────────────────────────
const StartTailoringSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
  jobTitle: z.string().min(1, "jobTitle is required"),
  company: z.string().min(1, "company is required"),
  jdText: z.string().optional().default(""),
});

const ApproveSchema = z.object({
  editedBullets: z
    .array(
      z.object({
        factId: z.string(),
        tailoredBullet: z.string(),
      }),
    )
    .optional(),
});

const RejectSchema = z.object({
  reason: z.string().optional().default(""),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function saveDoc(docData: Record<string, unknown>): Promise<StoredDoc> {
  if (isMongoReady()) {
    const doc = new Document(docData);
    return (await doc.save()).toObject() as StoredDoc;
  }
  const id = `doc_${docCounter++}_${Date.now()}`;
  const stored: StoredDoc = { _id: id, ...docData, createdAt: new Date(), updatedAt: new Date() };
  inMemoryDocs.set(id, stored);
  return stored;
}

async function findDoc(id: string): Promise<StoredDoc | null> {
  if (isMongoReady()) {
    return (await Document.findById(id).lean()) as StoredDoc | null;
  }
  return inMemoryDocs.get(id) || null;
}

async function updateDoc(id: string, updates: Partial<StoredDoc>): Promise<StoredDoc | null> {
  if (isMongoReady()) {
    return (await Document.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true },
    ).lean()) as StoredDoc | null;
  }
  const existing = inMemoryDocs.get(id);
  if (!existing) return null;
  const updated: StoredDoc = { ...existing, ...updates, updatedAt: new Date() };
  inMemoryDocs.set(id, updated);
  return updated;
}

async function listDocs(userId?: string): Promise<StoredDoc[]> {
  if (isMongoReady()) {
    return (await Document.find({ userId }).sort({ createdAt: -1 }).lean()) as StoredDoc[];
  }
  const uid = userId?.toString();
  return [...inMemoryDocs.values()]
    .filter((d) => d.userId?.toString() === uid)
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

// ── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/v1/tailor/start
 * Kick off the resume tailoring pipeline for a job.
 */
export async function startTailor(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    const parsed = StartTailoringSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0].message,
          requestId: req.id,
        },
      });
    }

    const { jobId, jobTitle, company, jdText } = parsed.data;
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

    // Run tailoring graph
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
    const doc = await saveDoc({
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

    return res.status(201).json({
      data: {
        documentId: doc._id,
        status: doc.status,
        jobTitle,
        company,
        bullets: result.bullets,
        summary: result.summary,
        atsMatch: result.atsMatch,
        requirements: result.requirements,
        message: "Draft created. Review bullets and approve or reject.",
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/tailor/:id/approve
 * Approve the draft (optionally with edits) and generate export files.
 */
export async function approveTailor(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    const doc = await findDoc(String(req.params.id));
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
      return res.status(200).json({
        data: {
          documentId: doc._id,
          status: doc.status,
          pdfUrl: doc.pdfStorageUrl,
          docxUrl: doc.docxStorageUrl,
          message: "Already approved.",
        },
      });
    }

    const parsed = ApproveSchema.safeParse(req.body);
    const editedBullets = parsed.success ? parsed.data.editedBullets : undefined;

    interface BulletItem {
      factId?: string;
      tailoredBullet?: string;
      [key: string]: unknown;
    }

    // Use edited bullets if provided, otherwise use draft bullets
    const finalBullets =
      editedBullets && editedBullets.length
        ? editedBullets.map((eb: { factId: string; tailoredBullet: string }) => ({
            ...((doc.tailoredBullets as BulletItem[]) || []).find((b) => b.factId === eb.factId),
            tailoredBullet: eb.tailoredBullet,
          }))
        : doc.tailoredBullets;

    // Export PDF + DOCX
    const exportResult = (await exportService.exportAndUpload({
      documentId: doc._id,
      candidateName: user.name || "Candidate",
      email: user.email,
      jobTitle: doc.jobTitle,
      company: doc.company,
      bullets: finalBullets,
    })) as { pdfUrl: string; docxUrl: string };

    const updated = (await updateDoc(doc._id, {
      status: "approved",
      tailoredBullets: finalBullets as unknown[],
      pdfStorageUrl: exportResult.pdfUrl,
      docxStorageUrl: exportResult.docxUrl,
      approvedAt: new Date(),
    })) as StoredDoc;

    logger.info({ userId, docId: doc._id }, "tailoring: approved and exported");

    return res.status(200).json({
      data: {
        documentId: updated._id,
        status: updated.status,
        pdfUrl: updated.pdfStorageUrl,
        docxUrl: updated.docxStorageUrl,
        approvedAt: updated.approvedAt,
        message: "Document approved and exported successfully.",
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/tailor/:id/reject
 * Reject the draft.
 */
export async function rejectTailor(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    const doc = await findDoc(String(req.params.id));
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

    const { reason } = RejectSchema.parse(req.body || {});
    const updated = (await updateDoc(doc._id, { status: "rejected" })) as StoredDoc;

    logger.info({ userId, docId: doc._id, reason }, "tailoring: rejected");

    return res.status(200).json({
      data: { documentId: updated._id, status: updated.status, reason },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/tailor/:id
 * Get document status and draft.
 */
export async function getTailoringDoc(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    const doc = await findDoc(String(req.params.id));
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
    return res.status(200).json({ data: { document: doc } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/tailor/:id/export?format=pdf|docx
 * Download exported file directly as binary.
 */
export async function exportDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    const doc = await findDoc(String(req.params.id));
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
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tailored_resume_${doc._id}.docx"`,
      );
      return res.send(docxBuffer);
    }
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/tailor
 * List all tailored documents for the authenticated user.
 */
export async function listTailoringDocs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const docs = await listDocs(userId);
    return res.status(200).json({
      data: { documents: docs, count: docs.length },
    });
  } catch (err) {
    next(err);
  }
}
