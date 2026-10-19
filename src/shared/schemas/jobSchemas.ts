import { z } from "zod";

export const feedbackSchema = z.object({
  feedback: z.enum(["thumbs_up", "thumbs_down"]),
  reason: z.string().optional().default(""),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

export const savedSearchFiltersSchema = z
  .object({
    q: z.string().trim().max(120).optional().default(""),
    location: z.string().trim().max(120).optional().default(""),
    countryCode: z.string().trim().max(2).optional().default(""),
    occupation: z.string().trim().max(60).optional().default(""),
    remoteType: z.enum(["", "remote", "hybrid", "onsite"]).optional().default(""),
    source: z.string().trim().max(60).optional().default(""),
    postedWithinDays: z.number().int().min(0).max(365).optional().default(0),
    minimumSalaryInr: z.number().min(0).nullable().optional().default(null),
    eligibility: z.enum(["", "eligible", "unknown"]).optional().default(""),
    showAnyway: z.boolean().optional().default(false),
  })
  .default({});
export type SavedSearchFiltersInput = z.infer<typeof savedSearchFiltersSchema>;

export const quietHoursSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    startHourUtc: z.number().int().min(0).max(23).optional().default(22),
    endHourUtc: z.number().int().min(0).max(23).optional().default(7),
  })
  .optional();
export type QuietHoursInput = z.infer<typeof quietHoursSchema>;

export const createSavedSearchSchema = z.object({
  name: z.string().trim().max(80).optional(),
  filters: savedSearchFiltersSchema,
  alertFrequency: z.enum(["none", "instant", "daily"]).optional().default("daily"),
  alertChannels: z
    .array(z.enum(["in_app", "email"]))
    .min(1)
    .max(2)
    .optional()
    .default(["in_app", "email"]),
  quietHours: quietHoursSchema,
  enabled: z.boolean().optional().default(true),
});
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchSchema>;

export const updateSavedSearchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  filters: savedSearchFiltersSchema.optional(),
  alertFrequency: z.enum(["none", "instant", "daily"]).optional(),
  alertChannels: z
    .array(z.enum(["in_app", "email"]))
    .min(1)
    .max(2)
    .optional(),
  quietHours: quietHoursSchema,
  enabled: z.boolean().optional(),
});
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchSchema>;

export const trackCompanySchema = z.object({ careersUrl: z.string().url().max(500) }).strict();
export type TrackCompanyInput = z.infer<typeof trackCompanySchema>;

export const reportJobSchema = z
  .object({ reason: z.enum(["expired", "broken_link", "misleading", "spam", "other"]) })
  .strict();
export type ReportJobInput = z.infer<typeof reportJobSchema>;

export const runDiscoverySchema = z
  .object({ broaden: z.boolean().optional().default(false) })
  .strict();
export type RunDiscoveryInput = z.infer<typeof runDiscoverySchema>;
