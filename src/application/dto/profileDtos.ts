import { z } from "zod";
import { IRoleHistoryItem, IPreferences } from "../../domain/entities/Profile.js";

export const getProfileInputSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

export type GetProfileInputDTO = z.infer<typeof getProfileInputSchema>;

export const upsertProfileInputSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  skills: z.array(z.string()).optional().default([]),
  roles: z
    .array(
      z.object({
        title: z.string().min(1),
        company: z.string().min(1),
        startDate: z.string().optional().default(""),
        endDate: z.string().optional().default(""),
        current: z.boolean().optional().default(false),
        description: z.string().optional().default(""),
        skills: z.array(z.string()).optional().default([]),
      }),
    )
    .optional()
    .default([]),
  preferences: z
    .object({
      targetRoles: z.array(z.string()).optional().default([]),
      minimumSalaryUsd: z.number().min(0).optional().default(0),
      preferredLocations: z.array(z.string()).optional().default([]),
      preferredCountryCodes: z.array(z.string()).optional().default([]),
      occupationCodes: z.array(z.string()).optional().default([]),
      remotePreference: z.enum(["remote", "hybrid", "onsite", "any"]).optional().default("any"),
    })
    .optional()
    .default({}),
  careerProfile: z.record(z.string(), z.unknown()).optional(),
});

export type UpsertProfileInputDTO = z.infer<typeof upsertProfileInputSchema>;

export interface ProfileOutputDTO {
  id: string;
  userId: string;
  skills: string[];
  roles: IRoleHistoryItem[];
  preferences: IPreferences;
  careerProfile?: Record<string, unknown>;
  matchTokens: string[];
  matchCountryCodes: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
