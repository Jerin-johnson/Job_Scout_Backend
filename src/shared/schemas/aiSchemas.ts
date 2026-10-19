import { z } from "zod";

export const historyTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(2000),
  })
  .strict();
export type HistoryTurnInput = z.infer<typeof historyTurnSchema>;

export const pageContextSchema = z
  .object({
    type: z.string().max(40).optional(),
    kind: z.string().max(40).optional(),
    id: z.string().max(120).optional(),
    label: z.string().max(120).optional(),
  })
  .optional();
export type PageContextInput = z.infer<typeof pageContextSchema>;

export const chatRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt cannot be empty").max(2000),
  threadId: z.string().max(120).optional(),
  history: z.array(historyTurnSchema).max(6).optional().default([]),
  pageContext: pageContextSchema,
  isRetry: z.boolean().optional(),
});
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

export const streamChatRequestSchema = chatRequestSchema.extend({
  modelId: z.string().min(1).max(100).optional(),
});
export type StreamChatRequestInput = z.infer<typeof streamChatRequestSchema>;

export const preferredNameSchema = z.object({ preferredName: z.string().trim().max(80) }).strict();
export type PreferredNameInput = z.infer<typeof preferredNameSchema>;

export const renameSessionSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();
export type RenameSessionInput = z.infer<typeof renameSessionSchema>;

export const confirmActionSchema = z
  .object({
    token: z.string().min(10),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();
export type ConfirmActionInput = z.infer<typeof confirmActionSchema>;
