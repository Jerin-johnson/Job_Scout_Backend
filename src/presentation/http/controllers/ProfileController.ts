import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { validateResumeMagicBytes } from "../../../shared/utils/fileValidation.js";
import { textExtractionService } from "../../../infrastructure/ai/textExtractionService.js";
import { resumeParserService } from "../../../infrastructure/ai/resumeParserService.js";
import { injectable, inject } from "tsyringe";
import { AuthenticatedRequest } from "../types/index.js";
import { GetProfileUseCase } from "../../../application/useCases/profile/GetProfileUseCase.js";
import { UpsertProfileUseCase } from "../../../application/useCases/profile/UpsertProfileUseCase.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";
import {
  profileRepository,
  ProfileRecord,
  ResumeRecord,
} from "../../../infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";
import { invalidateCandidateContext } from "../../../infrastructure/ai/candidateContext.js";
import { storageService } from "../../../infrastructure/storage/storageService.js";
import { z } from "zod";
import { acceptRequestQuota } from "../middleware/quotaGate.js";
import {
  userRepository,
  UserRecord,
} from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { enqueueMatchRefreshForUser } from "../../../infrastructure/database/mongoose/repositories/MongooseMatchRefreshRepository.js";
import {
  PLACE_CATALOG_VERSION,
  PLACE_SUGGESTIONS,
  normalizeSuggestionQuery,
  resolvePlacePair,
  suggestPlaces,
  suggestRoles,
} from "../../../domain/services/profile/profileSuggestionCatalog.js";
import {
  RESUME_AI_CONSENT_VERSION,
  requireResumeAiConsent,
} from "../../../domain/services/profile/resumeAiConsent.js";
import { deleteResumeForUser } from "../../../infrastructure/storage/MongooseResumeRepository.js";
import {
  JOB_ANALYTICS_CONSENT_VERSION,
  deleteInteractionEventsForUser,
} from "../../../infrastructure/database/mongoose/repositories/MongooseInteractionEventRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";
import {
  preferencesSchema,
  targetRolesSchema,
  careerProfileSchema,
  careerPatchSchema,
  resumeUploadRequestSchema,
  completeResumeUploadSchema,
  resumeAiConsentSchema,
  jobAnalyticsConsentSchema,
  MAX_RESUME_BYTES,
} from "../../../shared/schemas/profileSchemas.js";

export { careerProfileSchema };

interface EducationItem {
  degree?: string;
  institution?: string;
  [key: string]: unknown;
}

function educationLevelSuggestion(education: EducationItem[] = []): string | null {
  const text = education
    .map((item) => item.degree || "")
    .join(" ")
    .toLowerCase();
  if (/ph\.?d|doctorate/.test(text)) return "doctorate";
  if (/master|m\.?sc|m\.?tech|mba|md\b/.test(text)) return "masters";
  if (/bachelor|b\.?sc|b\.?tech|b\.?e\b|bca|degree/.test(text)) return "bachelors";
  if (/diploma|certificate/.test(text)) return "diploma";
  return null;
}

function dateMonth(value: unknown, now = new Date()): number | null {
  if (!value) return null;
  if (/^(present|current|now)$/i.test(String(value)))
    return now.getUTCFullYear() * 12 + now.getUTCMonth();
  const text = String(value).trim();
  const numeric = text.match(/^(\d{4})(?:[-/.](\d{1,2}))?$/);
  if (numeric) return Number(numeric[1]) * 12 + (numeric[2] ? Number(numeric[2]) - 1 : 0);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed)
    ? new Date(parsed).getUTCFullYear() * 12 + new Date(parsed).getUTCMonth()
    : null;
}

interface RoleItem {
  title?: string;
  company?: string;
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
  years?: number | null;
  [key: string]: unknown;
}

function deriveExperience(roles: RoleItem[] = [], now = new Date()): number | null {
  const intervals: [number, number][] = [];
  for (const role of roles) {
    const start = dateMonth(role.startDate, now);
    const end = role.isCurrent
      ? now.getUTCFullYear() * 12 + now.getUTCMonth()
      : dateMonth(role.endDate, now);
    if (start !== null && end !== null && end >= start) {
      intervals.push([start, end]);
    } else if (typeof role.years === "number" && Number.isFinite(role.years) && role.years > 0) {
      const months = Math.round(role.years * 12);
      const fakeEnd = now.getUTCFullYear() * 12 + now.getUTCMonth();
      intervals.push([fakeEnd - months, fakeEnd]);
    }
  }
  if (!intervals.length) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  let totalMonths = 0;
  let currentStart = intervals[0][0];
  let currentEnd = intervals[0][1];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s <= currentEnd) {
      currentEnd = Math.max(currentEnd, e);
    } else {
      totalMonths += currentEnd - currentStart;
      currentStart = s;
      currentEnd = e;
    }
  }
  totalMonths += currentEnd - currentStart;
  return Number((totalMonths / 12).toFixed(1));
}

function resolveSuggestionResponse(req: Request, res: Response, version: string, data: unknown) {
  const etag = `W/"profile-suggestions-${version}-${Buffer.from(JSON.stringify(data)).toString("base64url").slice(0, 20)}"`;
  res.set("ETag", etag).set("Cache-Control", "private, max-age=300");
  if (req.get("if-none-match") === etag) return res.status(304).end();
  return res.status(200).json(successResponse(data, { catalogVersion: version }));
}

function resumeExtension(filename: string, mimeType: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (
    (extension === "pdf" && mimeType === "application/pdf") ||
    (extension === "docx" &&
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  ) {
    return extension;
  }
  const error: Error & { statusCode?: number; code?: string } = new Error(
    "Choose a matching PDF or DOCX resume file.",
  );
  error.statusCode = 400;
  error.code = "INVALID_FILE_TYPE";
  throw error;
}

interface ProcessResumeParams {
  req: Request;
  userId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType?: string;
  s3Key?: string;
}

async function processResumeFile({
  req,
  userId,
  fileBuffer,
  originalFilename,
  s3Key,
}: ProcessResumeParams) {
  const validation = validateResumeMagicBytes(fileBuffer);
  if (!validation.valid) {
    const error: Error & { statusCode?: number; code?: string } = new Error(validation.error);
    error.statusCode = 400;
    error.code = "INVALID_FILE_TYPE";
    throw error;
  }

  const rawText =
    validation.mimeType === "application/pdf"
      ? await textExtractionService.extractPdf(fileBuffer)
      : await textExtractionService.extractDocx(fileBuffer);

  if (!rawText || rawText.length < 50) {
    const error: Error & { statusCode?: number; code?: string } = new Error(
      "We could not read enough selectable text. Scanned or image-only PDFs need OCR before upload.",
    );
    error.statusCode = 400;
    error.code = "INSUFFICIENT_TEXT";
    throw error;
  }

  await acceptRequestQuota(req, "resume_parse");
  const result = (await resumeParserService.parseResume({
    user: req.user,
    userId,
    fileBuffer,
    originalFilename,
    rawText,
    mimeType: validation.mimeType || "application/pdf",
    storedS3Key: s3Key,
  })) as { profile: unknown; factsSummary: unknown; resume: unknown };
  await invalidateCandidateContext(userId);
  return result;
}

function getUserId(user?: UserRecord): string {
  if (!user) return "";
  return user._id
    ? user._id.toString()
    : (user as unknown as { id?: string }).id
      ? (user as unknown as { id?: string }).id!.toString()
      : "";
}

export const profileController = {
  getResumeAiConsent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const userDoc = await userRepository.findById(userId);
    const consent = userDoc?.resumeAiConsent as { version?: string; acceptedAt?: Date } | undefined;
    res.status(200).json(
      successResponse({
        accepted: consent?.version === RESUME_AI_CONSENT_VERSION,
        version: RESUME_AI_CONSENT_VERSION,
        acceptedAt: consent?.acceptedAt || null,
      }),
    );
  }),

  acceptResumeAiConsent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const body = resumeAiConsentSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const acceptedAt = new Date();
    await userRepository.update(userId, {
      resumeAiConsent: { acceptedAt, version: body.version },
    });
    res.status(200).json(successResponse({ accepted: true, version: body.version, acceptedAt }));
  }),

  getJobAnalyticsConsent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const userDoc = await userRepository.findById(userId);
    const consent = userDoc?.jobAnalyticsConsent as
      { version?: string; acceptedAt?: Date } | undefined;
    res.status(200).json(
      successResponse({
        accepted: consent?.version === JOB_ANALYTICS_CONSENT_VERSION,
        version: JOB_ANALYTICS_CONSENT_VERSION,
        acceptedAt: consent?.acceptedAt || null,
      }),
    );
  }),

  updateJobAnalyticsConsent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const body = jobAnalyticsConsentSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    if (body.accepted) {
      const acceptedAt = new Date();
      await userRepository.update(userId, {
        jobAnalyticsConsent: { acceptedAt, version: body.version },
      });
      res.status(200).json(successResponse({ accepted: true, version: body.version, acceptedAt }));
      return;
    }
    await userRepository.update(userId, {
      jobAnalyticsConsent: { acceptedAt: null, version: null },
    });
    await deleteInteractionEventsForUser(userId);
    res.status(200).json(
      successResponse({
        accepted: false,
        version: JOB_ANALYTICS_CONSENT_VERSION,
        acceptedAt: null,
      }),
    );
  }),

  roleSuggestions: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const q = z
      .string()
      .trim()
      .min(2)
      .max(80)
      .parse(req.query.q || "");
    resolveSuggestionResponse(req, res, "roles-v1", { suggestions: suggestRoles(q) });
  }),

  placeSuggestions: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const q = z
      .string()
      .trim()
      .min(2)
      .max(100)
      .parse(req.query.q || "");
    const pair = resolvePlacePair(q);
    const suggestions = pair.suggestions || suggestPlaces(q);
    const ambiguous = new Set(["delhi", "punjab", "hyderabad"]).has(normalizeSuggestionQuery(q));
    resolveSuggestionResponse(req, res, PLACE_CATALOG_VERSION, {
      query: q,
      needsConfirmation: Boolean(pair.needsConfirmation || ambiguous),
      confirmationQuestion: pair.needsConfirmation || ambiguous ? "Is this in India?" : null,
      suggestions,
    });
  }),

  getCareerProfile: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const profile = await profileRepository.findByUserId(userId);
    const derivedExperience = deriveExperience((profile?.roles as RoleItem[]) || []);
    const careerProfile = profile?.careerProfile || {
      schemaVersion: 1,
      targetRoles: [],
      experience: {
        confirmedYears: null,
        derivedYears: null,
        internshipYears: null,
        needsConfirmation: true,
        confirmedAt: null,
      },
      homeLocation: {
        countryCode: null,
        subdivisionCode: null,
        cityCode: null,
        aliasCatalogVersion: PLACE_CATALOG_VERSION,
        confirmedAt: null,
      },
      targetLocations: [],
      workAuthorization: {
        canWorkInHomeCountry: null,
        sponsorshipOrRelocation: { enabled: false, countryCodes: [] },
      },
      workPreferences: { workMode: "any", employmentTypes: [], shiftPreference: null },
      compensation: { minimumAmount: null, currencyCode: null, period: null },
      moreDetails: {
        educationLevelCode: null,
        languages: [],
        testScores: [],
        availabilityCode: null,
        noticePeriodDays: null,
        certifications: [],
      },
    };
    const cExp = (
      careerProfile as {
        experience?: { confirmedAt?: string | null; confirmedYears?: number | null };
      }
    ).experience;
    res.status(200).json(
      successResponse({
        careerProfile: careerProfileSchema.parse(careerProfile),
        profileVersion: profile?.version || 1,
        suggestions: {
          educationLevel: educationLevelSuggestion((profile?.education as EducationItem[]) || []),
          targetRoles: (profile?.preferences as { targetRoles?: string[] } | undefined)?.targetRoles
            ?.length
            ? (profile?.preferences as { targetRoles?: string[] }).targetRoles
            : ((profile?.roles as RoleItem[]) || []).map((role) => role.title).slice(0, 3),
          derivedExperience,
          experienceNeedsConfirmation: !(cExp?.confirmedAt && cExp?.confirmedYears !== null),
        },
      }),
    );
  }),

  updateCareerProfile: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { careerProfile, profileVersion } = careerPatchSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const existing = await profileRepository.findByUserId(userId);
    if ((existing?.version || 1) !== profileVersion) {
      res
        .status(409)
        .json(
          errorResponse(
            "PROFILE_VERSION_CONFLICT",
            "Your profile changed. Refresh and try again.",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const profile = await profileRepository.upsertProfile(userId, { careerProfile });
    await invalidateCandidateContext(userId);
    const updatedUser = await userRepository.bumpProfileVersion(userId);
    if (updatedUser) await enqueueMatchRefreshForUser(userId, updatedUser.profileVersion);
    res
      .status(200)
      .json(
        successResponse({ careerProfile: profile.careerProfile, profileVersion: profile.version }),
      );
  }),

  createResumeUploadUrl: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const input = resumeUploadRequestSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    await requireResumeAiConsent(userId, userRepository);
    const extension = resumeExtension(input.originalFilename, input.mimeType);
    const uploadId = randomUUID();
    const key = `resumes/${userId}/${uploadId}.${extension}`;
    const signed = (await storageService.createPresignedUpload({
      key,
      contentType: input.mimeType,
      expiresInSeconds: 300,
    })) as { uploadUrl: string; requiredHeaders: Record<string, string> };

    res.status(200).json(
      successResponse({
        uploadId,
        uploadUrl: signed.uploadUrl,
        requiredHeaders: signed.requiredHeaders,
        expiresInSeconds: 300,
      }),
    );
  }),

  completeResumeUpload: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const input = completeResumeUploadSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const extension = resumeExtension(input.originalFilename, input.mimeType);
    const key = `resumes/${userId}/${input.uploadId}.${extension}`;
    const existingResume = await profileRepository.findResumeByS3KeyAndUserId(key, userId);
    if (existingResume) {
      const profile = await profileRepository.findByUserId(userId);
      res.status(200).json(
        successResponse({
          message: "Resume upload was already processed",
          profile,
          factsSummary: existingResume.factsSummary || {
            totalFacts: existingResume.parsedFactsCount,
          },
          resume: {
            id: existingResume._id!.toString(),
            originalFilename: existingResume.originalFilename,
            mimeType: existingResume.mimeType,
            createdAt: existingResume.createdAt,
            parsedFactsCount: existingResume.parsedFactsCount,
            factsSummary: existingResume.factsSummary,
            status: "ready",
          },
        }),
      );
      return;
    }
    await requireResumeAiConsent(userId, userRepository);
    const metadata = (await storageService.getObjectMetadata({ key })) as {
      contentLength: number;
      contentType: string;
      etag: string;
    };
    if (
      !Number.isInteger(metadata.contentLength) ||
      metadata.contentLength < 1 ||
      metadata.contentLength > MAX_RESUME_BYTES
    ) {
      const error: Error & { statusCode?: number; code?: string } = new Error(
        "Resume file must be between 1 byte and 5 MB.",
      );
      error.statusCode = 400;
      error.code = "INVALID_FILE_SIZE";
      throw error;
    }
    if (metadata.contentType !== input.mimeType) {
      const error: Error & { statusCode?: number; code?: string } = new Error(
        "Uploaded file type does not match the requested resume type.",
      );
      error.statusCode = 400;
      error.code = "INVALID_FILE_TYPE";
      throw error;
    }

    const fileBuffer = (await storageService.getFile({
      key,
      etag: metadata.etag,
    })) as Buffer;
    const result = await processResumeFile({
      req,
      userId,
      fileBuffer,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      s3Key: key,
    });
    res.status(200).json(
      successResponse({
        message: "Resume successfully parsed and encrypted",
        profile: result.profile,
        factsSummary: result.factsSummary,
        resume: result.resume,
      }),
    );
  }),

  listResumes: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const resumes = await profileRepository.findResumesByUserId(userId);
    res.status(200).json(
      successResponse({
        resumes: resumes.map(
          ({
            _id,
            originalFilename,
            mimeType,
            parsedFactsCount,
            factsSummary,
            createdAt,
          }: ResumeRecord) => ({
            id: _id!.toString(),
            originalFilename,
            mimeType,
            parsedFactsCount,
            factsSummary,
            createdAt,
            status: "ready",
          }),
        ),
      }),
    );
  }),

  deleteResume: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramId = String(req.params.id);
    if (!/^[a-f\d]{24}$/i.test(paramId)) {
      res.sendStatus(404);
      return;
    }
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const deleted = await deleteResumeForUser({ resumeId: paramId, userId });
    if (!deleted) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  }),

  rereadResume: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const paramId = String(req.params.id);
    if (!/^[a-f\d]{24}$/i.test(paramId)) {
      res.sendStatus(404);
      return;
    }
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    await requireResumeAiConsent(userId, userRepository);
    const resume = await profileRepository.findResumeByIdAndUserId(paramId, userId);
    if (!resume) {
      res.sendStatus(404);
      return;
    }
    const fileBuffer = (await storageService.getFile({
      key: resume.s3Key as string,
      etag: (resume.etag as string) || "",
    })) as Buffer;
    const result = await processResumeFile({
      req,
      userId,
      fileBuffer,
      originalFilename: resume.originalFilename as string,
      mimeType: resume.mimeType as string,
      s3Key: resume.s3Key as string,
    });
    res.status(200).json(
      successResponse({
        profile: result.profile,
        factsSummary: result.factsSummary,
        resume: result.resume,
        costNotice:
          "Up to a fraction of a cent if the content-hash cache misses; cached extractions avoid another model call.",
      }),
    );
  }),

  uploadResume: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res
        .status(400)
        .json(
          errorResponse(
            "FILE_REQUIRED",
            "Resume file is required (PDF or DOCX, max 5MB)",
            req.id ? String(req.id) : (req.headers["x-request-id"] as string) || undefined,
          ),
        );
      return;
    }

    const user = req.user as UserRecord;
    const userId = getUserId(user);
    await requireResumeAiConsent(userId, userRepository);
    const result = await processResumeFile({
      req,
      userId,
      fileBuffer: req.file.buffer,
      originalFilename: req.file.originalname,
    });

    res.status(200).json(
      successResponse({
        message: "Resume successfully parsed and encrypted",
        profile: result.profile,
        factsSummary: result.factsSummary,
        resume: result.resume,
      }),
    );
  }),

  getProfile: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const profile = await profileRepository.findByUserId(userId);

    if (!profile) {
      res
        .status(404)
        .json(
          errorResponse(
            "PROFILE_NOT_FOUND",
            "Candidate profile not yet created. Please upload a resume first.",
            req.id ? String(req.id) : (req.headers["x-request-id"] as string) || undefined,
          ),
        );
      return;
    }

    res.status(200).json(successResponse({ profile }));
  }),

  updatePreferences: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const preferences = preferencesSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);

    const profile = await profileRepository.upsertProfile(userId, { preferences });
    await invalidateCandidateContext(userId);
    const updatedUser = await userRepository.bumpProfileVersion(userId);
    if (updatedUser) await enqueueMatchRefreshForUser(userId, updatedUser.profileVersion);
    res
      .status(200)
      .json(successResponse({ profile, profileVersion: updatedUser?.profileVersion || null }));
  }),

  confirmTargetRoles: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { targetRoles } = targetRolesSchema.parse(req.body);
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const current = await profileRepository.findByUserId(userId);
    const preferences = {
      ...((current?.preferences as Record<string, unknown>) || {}),
      targetRoles,
    };
    const profile = await profileRepository.upsertProfile(userId, { preferences });
    await invalidateCandidateContext(userId);
    const updatedUser = await userRepository.bumpProfileVersion(userId);
    if (updatedUser) await enqueueMatchRefreshForUser(userId, updatedUser.profileVersion);
    res.status(200).json(
      successResponse({
        preferences: profile.preferences,
        profileVersion: updatedUser?.profileVersion || null,
      }),
    );
  }),

  getFacts: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user = req.user as UserRecord;
    const userId = getUserId(user);
    const profile = await profileRepository.findByUserId(userId);

    if (!profile) {
      res.status(200).json(successResponse({ totalFacts: 0, facts: [] }));
      return;
    }

    const facts: Record<string, unknown>[] = [];

    interface FactRole {
      factId?: string;
      title?: string;
      company?: string;
      achievements?: { factId?: string; bullet?: string; metrics?: unknown }[];
    }

    for (const role of (profile.roles as FactRole[]) || []) {
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

    interface FactSkill {
      factId?: string;
      name?: string;
      category?: string;
    }

    for (const skill of (profile.skills as FactSkill[]) || []) {
      facts.push({
        factId: skill.factId,
        type: "skill",
        label: skill.name,
        name: skill.name,
        category: skill.category,
      });
    }

    interface FactEducation {
      factId?: string;
      degree?: string;
      institution?: string;
    }

    for (const edu of (profile.education as FactEducation[]) || []) {
      facts.push({
        factId: edu.factId,
        type: "education",
        label: [edu.degree, edu.institution].filter(Boolean).join(" at "),
        degree: edu.degree,
        institution: edu.institution,
      });
    }

    res.status(200).json(
      successResponse({
        totalFacts: facts.length,
        facts,
      }),
    );
  }),
};

@injectable()
export class ProfileController {
  constructor(
    @inject(TOKENS.GetProfileUseCase)
    private readonly getProfileUseCase: GetProfileUseCase,
    @inject(TOKENS.UpsertProfileUseCase)
    private readonly upsertProfileUseCase: UpsertProfileUseCase,
  ) {}

  getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedError("User authentication required");
    }

    const profile = await this.getProfileUseCase.execute({ userId });
    res.status(200).json(successResponse(profile));
  });

  upsertProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedError("User authentication required");
    }

    const profile = await this.upsertProfileUseCase.execute({
      ...req.body,
      userId,
    });

    res.status(200).json(successResponse(profile));
  });
}
