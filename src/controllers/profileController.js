import { validateResumeMagicBytes } from "../shared/utils/fileValidation.js";
import { textExtractionService } from "../services/textExtractionService.js";
import { resumeParserService } from "../services/resumeParserService.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { invalidateCandidateContext } from "../ai/candidateContext.js";
import { z } from "zod";
import { acceptRequestQuota } from "../middleware/quotaGate.js";

const preferencesSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  minimumSalaryUsd: z.number().min(0).default(0),
  preferredLocations: z.array(z.string()).default([]),
  remotePreference: z.enum(["remote", "hybrid", "onsite", "any"]).default("any"),
});

export const profileController = {
  async listResumes(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const resumes = await profileRepository.findResumesByUserId(userId);
      return res.status(200).json({
        data: {
          resumes: resumes.map(
            ({ _id, originalFilename, mimeType, parsedFactsCount, createdAt }) => ({
              id: _id.toString(),
              originalFilename,
              mimeType,
              parsedFactsCount,
              createdAt,
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

      // 1. Magic bytes validation (reject extension spoofing)
      const validation = validateResumeMagicBytes(req.file.buffer);
      if (!validation.valid) {
        return res.status(400).json({
          error: {
            code: "INVALID_FILE_TYPE",
            message: validation.error,
            requestId: req.id || req.headers["x-request-id"] || "req_unknown",
          },
        });
      }

      // 2. Extract text from document
      let rawText = "";
      if (validation.mimeType === "application/pdf") {
        rawText = await textExtractionService.extractPdf(req.file.buffer);
      } else {
        rawText = await textExtractionService.extractDocx(req.file.buffer);
      }

      if (!rawText || rawText.length < 50) {
        return res.status(400).json({
          error: {
            code: "INSUFFICIENT_TEXT",
            message:
              "We could not read enough selectable text. Scanned or image-only PDFs need OCR before upload.",
            requestId: req.id || req.headers["x-request-id"] || "req_unknown",
          },
        });
      }

      await acceptRequestQuota(req, "resume_parse");

      // 3. Parse into structured facts and store
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const result = await resumeParserService.parseResume({
        user: req.user,
        userId,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        rawText,
        mimeType: validation.mimeType,
      });
      await invalidateCandidateContext(userId);

      res.status(200).json({
        data: {
          message: "Resume successfully parsed and encrypted",
          profile: result.profile,
          factsSummary: result.factsSummary,
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
      res.status(200).json({ data: { profile } });
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
