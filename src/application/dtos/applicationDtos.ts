import { z } from "zod";

export const createApplicationInputSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  company: z.string().min(1, "Company name is required").trim(),
  role: z.string().min(1, "Role is required").trim(),
  jobId: z.string().optional(),
  status: z
    .enum(["saved", "applied", "screening", "interviewing", "offer", "rejected"])
    .default("saved"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  location: z.string().optional().default(""),
  source: z.string().optional().default(""),
  salaryMin: z.number().nullable().optional(),
  salaryMax: z.number().nullable().optional(),
  notes: z.string().optional().default(""),
});

export type CreateApplicationInputDTO = z.infer<typeof createApplicationInputSchema>;

export const updateApplicationStatusSchema = z.object({
  id: z.string().min(1, "Application ID is required"),
  userId: z.string().min(1, "User ID is required"),
  status: z.enum(["saved", "applied", "screening", "interviewing", "offer", "rejected"]),
  note: z.string().optional().default(""),
});

export type UpdateApplicationStatusInputDTO = z.infer<typeof updateApplicationStatusSchema>;

export interface GetApplicationsInputDTO {
  userId: string;
  stages?: string[];
  priority?: string;
  pinned?: boolean;
  followUp?: "overdue" | "due-soon";
  stale?: boolean;
  staleDays?: number;
}

export interface ApplicationOutputDTO {
  id: string;
  userId: string;
  jobId: string | null;
  companyName: string;
  jobTitle: string;
  status: string;
  priority: string;
  appliedDate: Date;
  location?: string;
  source?: string;
  notes?: string;
  pinnedAt?: Date | null;
  archivedAt?: Date | null;
  nextFollowUpAt?: Date | null;
  lastActivityAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
