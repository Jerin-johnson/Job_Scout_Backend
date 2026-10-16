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
import { COUNTRY_ALIASES, ISO_SUBDIVISION_CODES, PLACE_CATALOG_VERSION, PLACE_SUGGESTIONS, normalizeSuggestionQuery, resolvePlacePair, suggestPlaces, suggestRoles } from "../services/profileSuggestionCatalog.js";

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
export const careerProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  targetRoles: z.array(z.object({ roleCode: z.string().trim().min(1).max(80).optional(), customRoleLabel: z.string().trim().min(1).max(120).optional(), custom: z.boolean() }).strict().refine((role) => role.roleCode || role.customRoleLabel, "Choose a curated role or enter a custom label")).max(20).default([]),
  experience: z.object({ confirmedYears: z.number().int().min(0).max(60).nullable().default(null), internshipYears: z.number().min(0).max(60).nullable().default(null), isFresher: z.boolean().default(false), needsConfirmation: z.boolean().default(true), confirmedAt: z.string().datetime().nullable().default(null) }).strict().default({}),
  homeLocation: z.object({ scope: z.enum(["city", "country", "anywhere_in_india", "anywhere_world", "remote"]).default("city"), countryCode: z.string().regex(/^[A-Z]{2}$/).refine((code) => COUNTRY_ALIASES.some((country) => country.code === code)).nullable().default(null), subdivisionCode: z.string().refine((code) => ISO_SUBDIVISION_CODES.has(code)).nullable().default(null), cityCode: z.string().max(100).nullable().default(null), aliasCatalogVersion: z.string().default(PLACE_CATALOG_VERSION), confirmedAt: z.string().datetime().nullable().default(null) }).strict().default({}),
  targetLocations: z.array(z.object({ scope: z.enum(["city", "country", "anywhere_in_india", "anywhere_world", "remote"]).default("city"), countryCode: z.string().regex(/^[A-Z]{2}$/).refine((code) => COUNTRY_ALIASES.some((country) => country.code === code)).nullable().default(null), subdivisionCode: z.string().refine((code) => ISO_SUBDIVISION_CODES.has(code)).nullable().default(null), cityCode: z.string().max(100).nullable().default(null), aliasCatalogVersion: z.string().default(PLACE_CATALOG_VERSION), confirmedAt: z.string().datetime().nullable().default(null) }).strict()).max(20).default([]),
  workAuthorization: z.object({ canWorkInHomeCountry: z.boolean().nullable().default(null), sponsorshipOrRelocation: z.object({ enabled: z.boolean().default(false), countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(20).default([]) }).strict().default({}) }).strict().default({}),
  workPreferences: z.object({ workMode: z.enum(["any", "remote", "hybrid", "onsite"]).default("any"), employmentTypes: z.array(z.enum(["full_time", "contract", "part_time"])).max(3).default([]), shiftPreference: z.enum(["day", "night", "rotating", "flexible"]).nullable().default(null) }).strict().default({}),
  compensation: z.object({ minimumAmount: z.number().nonnegative().nullable().default(null), currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable().default(null), period: z.enum(["hourly", "monthly", "annual"]).nullable().default(null) }).strict().default({}),
  moreDetails: z.object({ educationLevelCode: z.string().max(40).nullable().default(null), languages: z.array(z.object({ languageCode: z.string().regex(/^[a-z]{2}$/), proficiencyCode: z.enum(["beginner", "intermediate", "advanced", "native"]) }).strict()).max(20).default([]), testScores: z.array(z.object({ testCode: z.string().max(30), score: z.string().max(30), testDate: z.string().datetime().nullable().default(null) }).strict()).max(20).default([]), availabilityCode: z.string().max(40).nullable().default(null), noticePeriodDays: z.number().int().min(0).max(365).nullable().default(null), certifications: z.array(z.object({ name: z.string().max(120), issuer: z.string().max(120), countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().default(null), expiresAt: z.string().datetime().nullable().default(null) }).strict()).max(100).default([]) }).strict().default({}),
}).strict().superRefine((profile, context) => {
  const locations = [profile.homeLocation, ...profile.targetLocations];
  for (const [index, location] of locations.entries()) {
    if (["anywhere_in_india", "anywhere_world", "remote"].includes(location.scope)) continue;
    if (location.scope === "country" && !location.countryCode) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: index === 0 ? ["homeLocation", "countryCode"] : ["targetLocations", index - 1, "countryCode"], message: "Choose a country." });
    }
    if (!location.cityCode) continue;
    const city = PLACE_SUGGESTIONS.find((place) => place.code === location.cityCode);
    if (!city || city.countryCode !== location.countryCode || (city.subdivisionCode && location.subdivisionCode && city.subdivisionCode !== location.subdivisionCode)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: index === 0 ? ["homeLocation", "cityCode"] : ["targetLocations", index - 1, "cityCode"], message: "Choose a city that matches the selected country and subdivision." });
    }
  }
});
const careerPatchSchema = z.object({ profileVersion: z.number().int().min(1), careerProfile: careerProfileSchema }).strict();
const RESUME_AI_CONSENT_VERSION = "resume-ai-processing-v1";

async function requireResumeAiConsent(userId) {
  const user = await userRepository.findById(userId);
  if (user?.resumeAiConsent?.version === RESUME_AI_CONSENT_VERSION && user.resumeAiConsent.acceptedAt) return;
  const error = new Error("Please review and accept AI resume processing before uploading a resume.");
  error.statusCode = 403;
  error.code = "RESUME_AI_CONSENT_REQUIRED";
  throw error;
}

function educationLevelSuggestion(education = []) {
  const text = education.map((item) => item.degree || "").join(" ").toLowerCase();
  if (/ph\.?d|doctorate/.test(text)) return "doctorate";
  if (/master|m\.?sc|m\.?tech|mba|md\b/.test(text)) return "masters";
  if (/bachelor|b\.?sc|b\.?tech|b\.?e\b|bca|degree/.test(text)) return "bachelors";
  if (/diploma|certificate/.test(text)) return "diploma";
  return null;
}

function dateMonth(value, now = new Date()) {
  if (!value) return null;
  if (/^(present|current|now)$/i.test(value)) return now.getUTCFullYear() * 12 + now.getUTCMonth();
  const text = String(value).trim();
  const numeric = text.match(/^(\d{4})(?:[-/.](\d{1,2}))?$/);
  if (numeric) return Number(numeric[1]) * 12 + (numeric[2] ? Number(numeric[2]) - 1 : 0);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).getUTCFullYear() * 12 + new Date(parsed).getUTCMonth() : null;
}

function deriveExperience(roles = [], now = new Date()) {
  const intervals = [];
  let internshipMonths = 0;
  let incomplete = roles.length === 0;
  for (const role of roles) {
    const start = dateMonth(role.startDate, now);
    const end = dateMonth(role.endDate || (role.isCurrent ? "present" : ""), now);
    if (start === null || end === null || end < start) { incomplete = true; continue; }
    const months = end - start + 1;
    if (/intern(ship)?/i.test(role.title || "")) internshipMonths += months;
    else intervals.push([start, end + 1]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (!last || interval[0] > last[1]) merged.push([...interval]);
    else last[1] = Math.max(last[1], interval[1]);
  }
  const months = merged.reduce((sum, [start, end]) => sum + end - start, 0);
  return {
    derivedYears: months ? Number((months / 12).toFixed(1)) : null,
    internshipYears: internshipMonths ? Number((internshipMonths / 12).toFixed(1)) : null,
    needsConfirmation: incomplete || !roles.length,
  };
}

function resolveSuggestionResponse(req, res, version, data) {
  const etag = `W/"profile-suggestions-${version}-${Buffer.from(JSON.stringify(data)).toString("base64url").slice(0, 20)}"`;
  res.set("ETag", etag).set("Cache-Control", "private, max-age=300");
  if (req.get("if-none-match") === etag) return res.status(304).end();
  return res.status(200).json({ data, catalogVersion: version });
}

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
  async getResumeAiConsent(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const user = await userRepository.findById(userId);
      return res.status(200).json({ data: { accepted: user?.resumeAiConsent?.version === RESUME_AI_CONSENT_VERSION, version: RESUME_AI_CONSENT_VERSION, acceptedAt: user?.resumeAiConsent?.acceptedAt || null } });
    } catch (err) { next(err); }
  },

  async acceptResumeAiConsent(req, res, next) {
    try {
      const body = z.object({ accepted: z.literal(true), version: z.literal(RESUME_AI_CONSENT_VERSION) }).strict().parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const acceptedAt = new Date();
      await userRepository.update(userId, { resumeAiConsent: { acceptedAt, version: body.version } });
      return res.status(200).json({ data: { accepted: true, version: body.version, acceptedAt } });
    } catch (err) { next(err); }
  },

  async roleSuggestions(req, res, next) {
    try {
      const q = z.string().trim().min(2).max(80).parse(req.query.q || "");
      return resolveSuggestionResponse(req, res, "roles-v1", { suggestions: suggestRoles(q) });
    } catch (err) { next(err); }
  },

  async placeSuggestions(req, res, next) {
    try {
      const q = z.string().trim().min(2).max(100).parse(req.query.q || "");
      const pair = resolvePlacePair(q);
      const suggestions = pair.suggestions || suggestPlaces(q);
      const ambiguous = new Set(["delhi", "punjab", "hyderabad"]).has(normalizeSuggestionQuery(q));
      return resolveSuggestionResponse(req, res, PLACE_CATALOG_VERSION, {
        query: q,
        needsConfirmation: Boolean(pair.needsConfirmation || ambiguous),
        confirmationQuestion: pair.needsConfirmation || ambiguous ? "Is this in India?" : null,
        suggestions,
      });
    } catch (err) { next(err); }
  },

  async getCareerProfile(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const profile = await profileRepository.findByUserId(userId);
      const derivedExperience = deriveExperience(profile?.roles || []);
      const careerProfile = profile?.careerProfile || {
        schemaVersion: 1, targetRoles: [], experience: { confirmedYears: null, derivedYears: null, internshipYears: null, needsConfirmation: true, confirmedAt: null },
        homeLocation: { countryCode: null, subdivisionCode: null, cityCode: null, aliasCatalogVersion: PLACE_CATALOG_VERSION, confirmedAt: null },
        targetLocations: [], workAuthorization: { canWorkInHomeCountry: null, sponsorshipOrRelocation: { enabled: false, countryCodes: [] } },
        workPreferences: { workMode: "any", employmentTypes: [], shiftPreference: null },
        compensation: { minimumAmount: null, currencyCode: null, period: null },
        moreDetails: { educationLevelCode: null, languages: [], testScores: [], availabilityCode: null, noticePeriodDays: null, certifications: [] },
      };
      return res.status(200).json({
        data: {
          careerProfile: careerProfileSchema.parse(careerProfile),
          profileVersion: profile?.version || 1,
          suggestions: {
            educationLevel: educationLevelSuggestion(profile?.education || []),
            targetRoles: profile?.preferences?.targetRoles?.length ? profile.preferences.targetRoles : (profile?.roles || []).map((role) => role.title).slice(0, 3),
            derivedExperience,
            experienceNeedsConfirmation: !(careerProfile.experience?.confirmedAt && careerProfile.experience?.confirmedYears !== null),
          },
        },
      });
    } catch (err) { next(err); }
  },

  async updateCareerProfile(req, res, next) {
    try {
      const { careerProfile, profileVersion } = careerPatchSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const existing = await profileRepository.findByUserId(userId);
      if ((existing?.version || 1) !== profileVersion) {
        return res.status(409).json({ error: { code: "PROFILE_VERSION_CONFLICT", message: "Your profile changed. Refresh and try again.", requestId: req.id } });
      }
      const profile = await profileRepository.upsertProfile(userId, { careerProfile });
      await invalidateCandidateContext(userId);
      const updatedUser = await userRepository.bumpProfileVersion(userId);
      if (updatedUser) await enqueueMatchRefreshForUser(userId, updatedUser.profileVersion);
      return res.status(200).json({ data: { careerProfile: profile.careerProfile, profileVersion: profile.version } });
    } catch (err) { next(err); }
  },

  async createResumeUploadUrl(req, res, next) {
    try {
      const input = resumeUploadRequestSchema.parse(req.body);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      await requireResumeAiConsent(userId);
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
      await requireResumeAiConsent(userId);
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

  async rereadResume(req, res, next) {
    try {
      if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.sendStatus(404);
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      await requireResumeAiConsent(userId);
      const resume = await profileRepository.findResumeByIdAndUserId(req.params.id, userId);
      if (!resume) return res.sendStatus(404);
      const fileBuffer = await storageService.getFile({ key: resume.s3Key });
      const result = await processResumeFile({ req, userId, fileBuffer, originalFilename: resume.originalFilename, mimeType: resume.mimeType, s3Key: resume.s3Key });
      return res.status(200).json({ data: { profile: result.profile, factsSummary: result.factsSummary, resume: result.resume, costNotice: "Up to a fraction of a cent if the content-hash cache misses; cached extractions avoid another model call." } });
    } catch (err) { return next(err); }
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
      await requireResumeAiConsent(userId);
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
