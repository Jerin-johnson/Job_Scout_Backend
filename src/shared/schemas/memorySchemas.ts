import { z } from "zod";
import { MEMORY_CONSENT_VERSION } from "../../ai/memory/longTerm.js";

export const updateMemorySchema = z
  .object({
    key: z.string().trim().min(1).max(120).optional(),
    content: z.string().trim().min(1).max(1000).optional(),
    type: z.enum(["preference", "fact", "feedback", "episode", "goal"]).optional(),
    importance: z.number().int().min(1).max(5).optional(),
  })
  .strict();
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;

export const createMemorySchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(1000),
    type: z.enum(["preference", "fact", "feedback", "episode", "goal"]).default("preference"),
    importance: z.number().int().min(1).max(5).default(3),
  })
  .strict();
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

export const consentSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true), version: z.literal(MEMORY_CONSENT_VERSION) }).strict(),
  z.object({ accepted: z.literal(false) }).strict(),
]);
export type ConsentInput = z.infer<typeof consentSchema>;
