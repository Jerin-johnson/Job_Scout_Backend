import { validateResumeMagicBytes } from "../shared/utils/fileValidation.js";
import { textExtractionService } from "../services/textExtractionService.js";
import { resumeParserService } from "../services/resumeParserService.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { z } from "zod";

const preferencesSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  minimumSalaryUsd: z.number().min(0).default(0),
  preferredLocations: z.array(z.string()).default([]),
  remotePreference: z.enum(["remote", "hybrid", "onsite", "any"]).default("any"),
});

export const profileController = {
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
              "Unable to extract sufficient text from document. Ensure it is not scanned/image-only.",
            requestId: req.id || req.headers["x-request-id"] || "req_unknown",
          },
        });
      }

      // 3. Parse into structured facts and store
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const result = await resumeParserService.parseResume({
        userId,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        rawText,
        mimeType: validation.mimeType,
      });

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
        return res.status(404).json({
          error: {
            code: "PROFILE_NOT_FOUND",
            message: "No profile found",
            requestId: req.id || req.headers["x-request-id"] || "req_unknown",
          },
        });
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
            bullet: ach.bullet,
            metrics: ach.metrics,
          });
        }
      }

      for (const skill of profile.skills || []) {
        facts.push({
          factId: skill.factId,
          type: "skill",
          name: skill.name,
          category: skill.category,
        });
      }

      for (const edu of profile.education || []) {
        facts.push({
          factId: edu.factId,
          type: "education",
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
