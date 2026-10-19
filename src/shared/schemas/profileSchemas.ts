import { z } from "zod";
import {
  COUNTRY_ALIASES,
  ISO_SUBDIVISION_CODES,
  PLACE_CATALOG_VERSION,
  PLACE_SUGGESTIONS,
} from "../../services/profileSuggestionCatalog.js";

export const preferencesSchema = z.object({
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
export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const targetRolesSchema = z
  .object({
    targetRoles: z.array(z.string().trim().min(1).max(120)).max(10),
  })
  .strict();
export type TargetRolesInput = z.infer<typeof targetRolesSchema>;

export const careerProfileSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    targetRoles: z
      .array(
        z
          .object({
            roleCode: z.string().trim().min(1).max(80).optional(),
            customRoleLabel: z.string().trim().min(1).max(120).optional(),
            custom: z.boolean(),
          })
          .strict()
          .refine(
            (role) => role.roleCode || role.customRoleLabel,
            "Choose a curated role or enter a custom label",
          ),
      )
      .max(20)
      .default([]),
    experience: z
      .object({
        confirmedYears: z.number().int().min(0).max(60).nullable().default(null),
        internshipYears: z.number().min(0).max(60).nullable().default(null),
        isFresher: z.boolean().default(false),
        needsConfirmation: z.boolean().default(true),
        confirmedAt: z.string().datetime().nullable().default(null),
      })
      .strict()
      .default({}),
    homeLocation: z
      .object({
        scope: z
          .enum(["city", "country", "anywhere_in_india", "anywhere_world", "remote"])
          .default("city"),
        countryCode: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .refine((code) => COUNTRY_ALIASES.some((country) => country.code === code))
          .nullable()
          .default(null),
        subdivisionCode: z
          .string()
          .refine((code) => ISO_SUBDIVISION_CODES.has(code))
          .nullable()
          .default(null),
        cityCode: z.string().max(100).nullable().default(null),
        aliasCatalogVersion: z.string().default(PLACE_CATALOG_VERSION),
        confirmedAt: z.string().datetime().nullable().default(null),
      })
      .strict()
      .default({}),
    targetLocations: z
      .array(
        z
          .object({
            scope: z
              .enum(["city", "country", "anywhere_in_india", "anywhere_world", "remote"])
              .default("city"),
            countryCode: z
              .string()
              .regex(/^[A-Z]{2}$/)
              .refine((code) => COUNTRY_ALIASES.some((country) => country.code === code))
              .nullable()
              .default(null),
            subdivisionCode: z
              .string()
              .refine((code) => ISO_SUBDIVISION_CODES.has(code))
              .nullable()
              .default(null),
            cityCode: z.string().max(100).nullable().default(null),
            aliasCatalogVersion: z.string().default(PLACE_CATALOG_VERSION),
            confirmedAt: z.string().datetime().nullable().default(null),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    workAuthorization: z
      .object({
        canWorkInHomeCountry: z.boolean().nullable().default(null),
        sponsorshipOrRelocation: z
          .object({
            enabled: z.boolean().default(false),
            countryCodes: z
              .array(z.string().regex(/^[A-Z]{2}$/))
              .max(20)
              .default([]),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    workPreferences: z
      .object({
        workMode: z.enum(["any", "remote", "hybrid", "onsite"]).default("any"),
        employmentTypes: z
          .array(z.enum(["full_time", "contract", "part_time"]))
          .max(3)
          .default([]),
        shiftPreference: z.enum(["day", "night", "rotating", "flexible"]).nullable().default(null),
      })
      .strict()
      .default({}),
    compensation: z
      .object({
        minimumAmount: z.number().nonnegative().nullable().default(null),
        currencyCode: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable()
          .default(null),
        period: z.enum(["hourly", "monthly", "annual"]).nullable().default(null),
      })
      .strict()
      .default({}),
    moreDetails: z
      .object({
        educationLevelCode: z.string().max(40).nullable().default(null),
        languages: z
          .array(
            z
              .object({
                languageCode: z.string().regex(/^[a-z]{2}$/),
                proficiencyCode: z.enum(["beginner", "intermediate", "advanced", "native"]),
              })
              .strict(),
          )
          .max(20)
          .default([]),
        testScores: z
          .array(
            z
              .object({
                testCode: z.string().max(30),
                score: z.string().max(30),
                testDate: z.string().datetime().nullable().default(null),
              })
              .strict(),
          )
          .max(20)
          .default([]),
        availabilityCode: z.string().max(40).nullable().default(null),
        noticePeriodDays: z.number().int().min(0).max(365).nullable().default(null),
        certifications: z
          .array(
            z
              .object({
                name: z.string().max(120),
                issuer: z.string().max(120),
                countryCode: z
                  .string()
                  .regex(/^[A-Z]{2}$/)
                  .nullable()
                  .default(null),
                expiresAt: z.string().datetime().nullable().default(null),
              })
              .strict(),
          )
          .max(100)
          .default([]),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((profile, context) => {
    const locations = [profile.homeLocation, ...profile.targetLocations];
    for (const [index, location] of locations.entries()) {
      if (["anywhere_in_india", "anywhere_world", "remote"].includes(location.scope)) continue;
      if (location.scope === "country" && !location.countryCode) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path:
            index === 0
              ? ["homeLocation", "countryCode"]
              : ["targetLocations", index - 1, "countryCode"],
          message: "Choose a country.",
        });
      }
      if (!location.cityCode) continue;
      const city = PLACE_SUGGESTIONS.find((place) => place.code === location.cityCode);
      if (
        !city ||
        city.countryCode !== location.countryCode ||
        (city.subdivisionCode &&
          location.subdivisionCode &&
          city.subdivisionCode !== location.subdivisionCode)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path:
            index === 0 ? ["homeLocation", "cityCode"] : ["targetLocations", index - 1, "cityCode"],
          message: "Choose a city that matches the selected country and subdivision.",
        });
      }
    }
  });
export type CareerProfileInput = z.infer<typeof careerProfileSchema>;

export const careerPatchSchema = z
  .object({
    profileVersion: z.number().int().min(1),
    careerProfile: careerProfileSchema,
  })
  .strict();
export type CareerPatchInput = z.infer<typeof careerPatchSchema>;

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const resumeUploadRequestSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  fileSize: z.number().int().min(1).max(MAX_RESUME_BYTES),
});
export type ResumeUploadRequestInput = z.infer<typeof resumeUploadRequestSchema>;

export const completeResumeUploadSchema = z.object({
  uploadId: z.string().uuid(),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: resumeUploadRequestSchema.shape.mimeType,
});
export type CompleteResumeUploadInput = z.infer<typeof completeResumeUploadSchema>;

export const resumeAiConsentSchema = z
  .object({
    accepted: z.literal(true),
    version: z.literal("resume-ai-processing-v1"),
  })
  .strict();
export type ResumeAiConsentInput = z.infer<typeof resumeAiConsentSchema>;

export const jobAnalyticsConsentSchema = z.discriminatedUnion("accepted", [
  z
    .object({
      accepted: z.literal(true),
      version: z.literal("job-analytics-v1"),
    })
    .strict(),
  z.object({ accepted: z.literal(false) }).strict(),
]);
export type JobAnalyticsConsentInput = z.infer<typeof jobAnalyticsConsentSchema>;
