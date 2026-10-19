import { z } from "zod";

export const optionalDate = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.union([z.null(), z.coerce.date()]),
);

export const optionalSalary = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.union([z.null(), z.coerce.number().finite().nonnegative()]),
);

export const createApplicationSchema = z.object({
  jobId: z.string().optional(),
  company: z.string().min(1, "Company is required"),
  role: z.string().min(1, "Role is required"),
  location: z.string().optional(),
  salary: z.string().optional(),
  salaryMin: optionalSalary.optional(),
  salaryMax: optionalSalary.optional(),
  url: z.string().url().optional().or(z.literal("")),
  jobUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  source: z.string().optional(),
  status: z
    .enum(["saved", "applied", "screening", "interviewing", "offer", "rejected", "ghosted"])
    .default("saved"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  pinned: z.boolean().default(false),
  pinnedAt: optionalDate.optional(),
  notes: z.string().max(5000).optional(),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().default(false),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z.object({
  company: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  location: z.string().optional(),
  salary: z.string().optional(),
  salaryMin: optionalSalary.optional(),
  salaryMax: optionalSalary.optional(),
  url: z.string().url().optional().or(z.literal("")).or(z.null()),
  jobUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  source: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  pinned: z.boolean().optional(),
  pinnedAt: optionalDate.optional(),
  notes: z.string().max(5000).optional(),
  nextFollowUpAt: optionalDate.optional(),
  reminderEnabled: z.boolean().optional(),
});
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export const updateApplicationStatusSchema = z.object({
  status: z.enum(["saved", "applied", "screening", "interviewing", "offer", "rejected", "ghosted"]),
  note: z.string().max(1000).optional(),
});
export type UpdateApplicationStatusInput = z.infer<typeof updateApplicationStatusSchema>;

export const archiveApplicationSchema = z.object({
  archived: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type ArchiveApplicationInput = z.infer<typeof archiveApplicationSchema>;
