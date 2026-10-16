import { randomUUID } from "node:crypto";
import { validateResumeMagicBytes } from "../shared/utils/fileValidation.js";
import { textExtractionService } from "../services/textExtractionService.js";
import { resumeParserService } from "../services/resumeParserService.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { invalidateCandidateContext } from "../ai/candidateContext.js";
import { storageService } from "../services/storageService.js";
import { z } from "zod";
import { acceptRequestQuota } from "../middleware/quotaGate.js";
import { userRepository } from "../repositories/userRepository.js";
import { enqueueMatchRefreshForUser } from "../services/matchRefreshService.js";

const preferencesSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  minimumSalaryUsd: z.number().min(0).default(0),
  preferredLocations: z.array(z.string()).default([]),
  preferredCountryCodes: z
    .array(z.string().regex(/^[A-Za-z]{2}$/))
    .max(30)
    .default([]),
  occupationCodes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  remotePreference: z.enum(["remote", "hybrid", "onsite", "any"]).default("any"),
});
const targetRolesSchema = z.object({
  targetRoles: z.array(z.string().trim().min(1).max(120)).max(10),
}).strict();

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const resumeUploadRequestSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  fileSize: z.number().int().min(1).max(MAX_RESUME_BYTES),
});
const completeResumeUploadSchema = z.object({
  uploadId: z.string().uuid(),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: resumeUploadRequestSchema.shape.mimeType,
});

function resumeExtension(filename, mimeType) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (
    (extension === "pdf" && mimeType === "application/pdf") ||
    (extension === "docx" &&
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  ) {
    return extension;
  }
  const error = new Error("Choose a matching PDF or DOCX resume file.");
  error.statusCode = 400;
  error.code = "INVALID_FILE_TYPE";
  throw error;
}

async function processResumeFile({ req, userId, fileBuffer, originalFilename, s3Key }) {
  const validation = validateResumeMagicBytes(fileBuffer);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    error.code = "INVALID_FILE_TYPE";
    throw error;
  }

  const rawText =
    validation.mimeType === "application/pdf"
      ? await textExtractionService.extractPdf(fileBuffer)
      : await textExtractionService.extractDocx(fileBuffer);

  if (!rawText || rawText.length < 50) {
    const error = new Error(
      "We could not read enough selectable text. Scanned or image-only PDFs need OCR before upload.",
    );
    error.statusCode = 400;
    error.code = "INSUFFICIENT_TEXT";
    throw error;
  }

  await acceptRequestQuota(req, "resume_parse");
  const result = await resumeParserService.parseResume({
    user: req.user,
    userId,
    fileBuffer,
    originalFilename,
    rawText,
    mimeType: validation.mimeType,
    storedS3Key: s3Key,
  });
  await invalidateCandidateContext(userId);
  return result;
}

export const profileController = {
  async createResumeUploadUrl(req, res, next) {
    try {
      const input = resumeUploadRequestSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const extension = resumeExtension(input.originalFilename, input.mimeType);
      const uploadId = randomUUID();
      const key = `resumes/${userId}/${uploadId}.${extension}`;
      const signed = await storageService.createPresignedUpload({
        key,
        contentType: input.mimeType,
        expiresInSeconds: 300,
      });

      return res.status(200).json({
        data: {
          uploadId,
          uploadUrl: signed.uploadUrl,
          requiredHeaders: signed.requiredHeaders,
          expiresInSeconds: 300,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async completeResumeUpload(req, res, next) {
    try {
      const input = completeResumeUploadSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const extension = resumeExtension(input.originalFilename, input.mimeType);
      const key = `resumes/${userId}/${input.uploadId}.${extension}`;
      const existingResume = await profileRepository.findResumeByS3KeyAndUserId(key, userId);
      if (existingResume) {
        const profile = await profileRepository.findByUserId(userId);
        return res.status(200).json({
          data: {
            message: "Resume upload was already processed",
            profile,
            factsSummary: existingResume.factsSummary || {
              totalFacts: existingResume.parsedFactsCount,
            },
            resume: {
              id: existingResume._id.toString(),
              originalFilename: existingResume.originalFilename,
              mimeType: existingResume.mimeType,
              createdAt: existingResume.createdAt,
              parsedFactsCount: existingResume.parsedFactsCount,
              factsSummary: existingResume.factsSummary,
              status: "ready",
            },
          },
        });
      }
      const metadata = await storageService.getObjectMetadata({ key });
      if (
        !Number.isInteger(metadata.contentLength) ||
        metadata.contentLength < 1 ||
        metadata.contentLength > MAX_RESUME_BYTES
      ) {
        const error = new Error("Resume file must be between 1 byte and 5 MB.");
        error.statusCode = 400;
        error.code = "INVALID_FILE_SIZE";
        throw error;
      }
      if (metadata.contentType !== input.mimeType) {
        const error = new Error("Uploaded file type does not match the requested resume type.");
        error.statusCode = 400;
        error.code = "INVALID_FILE_TYPE";
        throw error;
      }

      const fileBuffer = await storageService.getFile({ key, etag: metadata.etag });
      const result = await processResumeFile({
        req,
        userId,
        fileBuffer,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        s3Key: key,
      });
      return res.status(200).json({
        data: {
          message: "Resume successfully parsed and encrypted",
          profile: result.profile,
          factsSummary: result.factsSummary,
          resume: result.resume,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listResumes(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const resumes = await profileRepository.findResumesByUserId(userId);
      return res.status(200).json({
        data: {
          resumes: resumes.map(
            ({ _id, originalFilename, mimeType, parsedFactsCount, factsSummary, createdAt }) => ({
              id: _id.toString(),
              originalFilename,
              mimeType,
              parsedFactsCount,
              factsSummary,
              createdAt,
              status: "ready",
            }),
          ),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async uploadResume(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: {
            code: "FILE_REQUIRED",
            message: "Resume file is required (PDF or DOCX, max 5MB)",
            requestId: req.id || req.headers["x-request-id"] || "req_unknown",
          },
        });
      }

      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const result = await processResumeFile({
        req,
        userId,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
      });

      res.status(200).json({
        data: {
          message: "Resume successfully parsed and encrypted",
          profile: result.profile,
          factsSummary: result.factsSummary,
          resume: result.resume,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async getProfile(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const profile = await profileRepository.findByUserId(userId);

      if (!profile) {
        return res.status(404).json({
          error: {
            code: "PROFILE_NOT_FOUND",
            message: "Candidate profile not yet created. Please upload a resume first.",
            requestId: req.id || req.headers["x-request-id"] || "req_unknown",
          },
        });
      }

      res.status(200).json({ data: { profile } });
    } catch (err) {
      next(err);
    }
  },

  async updatePreferences(req, res, next) {
    try {
      const preferences = preferencesSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;

      const profile = await profileRepository.upsertProfile(userId, { preferences });
      await invalidateCandidateContext(userId);
      const updatedUser = await userRepository.bumpProfileVersion(userId);
      if (updatedUser) await enqueueMatchRefreshForUser(userId, updatedUser.profileVersion);
      res
        .status(200)
        .json({ data: { profile, profileVersion: updatedUser?.profileVersion || null } });
    } catch (err) {
      next(err);
    }
  },

  async confirmTargetRoles(req, res, next) {
    try {
      const { targetRoles } = targetRolesSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const current = await profileRepository.findByUserId(userId);
      const preferences = { ...(current?.preferences || {}), targetRoles };
      const profile = await profileRepository.upsertProfile(userId, { preferences });
      await invalidateCandidateContext(userId);
      const updatedUser = await userRepository.bumpProfileVersion(userId);
      if (updatedUser) await enqueueMatchRefreshForUser(userId, updatedUser.profileVersion);
      res.status(200).json({ data: { preferences: profile.preferences, profileVersion: updatedUser?.profileVersion || null } });
    } catch (err) {
      next(err);
    }
  },

  async getFacts(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const profile = await profileRepository.findByUserId(userId);

      if (!profile) {
        // Facts are a collection resource: a user without an uploaded resume has
        // an empty collection, not a failed request. This keeps first-run UI in
        // its upload state and gives clients the same contract in both cases.
        return res.status(200).json({ data: { totalFacts: 0, facts: [] } });
      }

      // Flatten facts for truthfulness check and candidate review
      const facts = [];

      for (const role of profile.roles || []) {
        facts.push({
          factId: role.factId,
          type: "role",
          label: `${role.title} at ${role.company}`,
        });
        for (const ach of role.achievements || []) {
          facts.push({
            factId: ach.factId,
            type: "achievement",
            label: ach.bullet,
            bullet: ach.bullet,
            metrics: ach.metrics,
          });
        }
      }

      for (const skill of profile.skills || []) {
        facts.push({
          factId: skill.factId,
          type: "skill",
          label: skill.name,
          name: skill.name,
          category: skill.category,
        });
      }

      for (const edu of profile.education || []) {
        facts.push({
          factId: edu.factId,
          type: "education",
          label: [edu.degree, edu.institution].filter(Boolean).join(" at "),
          degree: edu.degree,
          institution: edu.institution,
        });
      }

      res.status(200).json({
        data: {
          totalFacts: facts.length,
          facts,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
