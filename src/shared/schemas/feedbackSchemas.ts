import { z } from "zod";

export const feedbackInputSchema = z
  .object({
    category: z.enum(["general", "bug", "idea"]).default("general"),
    message: z.string().trim().min(10).max(2000),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
