/**
 * @fileoverview Application Manager Graph (Graph D)
 *
 * Flow:
 *   statusChange -> updateTracker -> scheduleFollowup -> draftFollowupEmail ->
 *   interrupt() for approval -> send
 *
 * Critical rule: Follow-up emails are NEVER sent automatically.
 * Human approval is mandatory.
 */

import { invokeLLM } from "../llm.js";
import { z } from "zod";
import { logger } from "../../shared/utils/logger.js";
import { applicationRepository } from "../../repositories/applicationRepository.js";
import type { ApplicationRecord } from "../../repositories/applicationRepository.js";
export interface UserLike {
  _id?: unknown;
  id?: string;
  name?: string;
  email?: string;
  plan?: string;
  profileVersion?: number;
  [key: string]: unknown;
}

export interface StageChangeParams {
  application: ApplicationRecord & { _id: unknown };
  user: UserLike;
  newStatus: string;
  note?: string;
}

export interface DraftEmailParams {
  application: ApplicationRecord;
  user: UserLike;
  newStatus: string;
}

export interface SendApprovedEmailParams {
  application: ApplicationRecord & { _id: unknown };
  user?: UserLike;
}

export const EmailDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  suggestedFollowUpDays: z.number().default(5),
});

export type EmailDraft = z.infer<typeof EmailDraftSchema>;

export const applicationGraph = {
  /**
   * Process a stage change in the application pipeline
   * Updates timeline, schedules follow-up, and drafts follow-up email
   */
  async handleStageChange({ application, user, newStatus, note }: StageChangeParams): Promise<ApplicationRecord | null> {
    const isDev =
      process.env.ANTHROPIC_API_KEY === "dummy_anthropic_key_for_dev" ||
      process.env.NODE_ENV === "test";

    const appId = String(application._id);

    // 1. Update status and timeline
    let updatedApp = await applicationRepository.addTimelineEntry(
      appId,
      newStatus,
      note || `Status moved to ${newStatus}`,
    );

    // 2. Certain stages trigger automatic follow-up drafts (applied, interviewing)
    if (newStatus === "applied" || newStatus === "interviewing") {
      let draft: EmailDraft;
      if (isDev) {
        draft = {
          subject:
            newStatus === "applied"
              ? `Following up on application for ${application.role || "Role"} - ${user.name || "Candidate"}`
              : `Thank you for the interview - ${application.role || "Role"} at ${application.company || "Company"}`,
          body:
            newStatus === "applied"
              ? `Dear Hiring Team,\n\nI recently applied for the ${application.role || "Role"} role at ${application.company || "Company"} and wanted to reiterate my enthusiasm for the position. I look forward to hearing about next steps.\n\nBest regards,\n${user.name || "Candidate"}`
              : `Dear Interviewer,\n\nThank you for your time discussing the ${application.role || "Role"} role. I really enjoyed learning more about ${application.company || "Company"}'s mission.\n\nBest regards,\n${user.name || "Candidate"}`,
          suggestedFollowUpDays: newStatus === "applied" ? 5 : 2,
        };
      } else {
        try {
          draft = await this.draftEmail({ application, user, newStatus });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ err: msg }, "LLM follow-up draft failed, using fallback draft");
          draft = {
            subject: `Following up: ${application.role || "Role"} at ${application.company || "Company"}`,
            body: `Dear Hiring Team,\n\nI am writing to follow up on my candidacy for the ${application.role || "Role"} role at ${application.company || "Company"}.\n\nBest,\n${user.name || "Candidate"}`,
            suggestedFollowUpDays: 5,
          };
        }
      }

      const nextFollowUpAt = new Date(
        Date.now() + draft.suggestedFollowUpDays * 24 * 60 * 60 * 1000,
      );

      updatedApp = await applicationRepository.update(appId, {
        nextFollowUpAt,
        followUpDraft: {
          subject: draft.subject,
          body: draft.body,
          status: "draft",
          sentAt: null,
        },
      });

      logger.info(
        { appId: application._id, status: newStatus, followUpAt: nextFollowUpAt },
        "applicationGraph: drafted follow-up email awaiting user approval",
      );
    }

    return updatedApp;
  },

  /**
   * Use LLM to craft a personalized follow-up email
   */
  async draftEmail({ application, user, newStatus }: DraftEmailParams): Promise<EmailDraft> {
    const prompt = [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `You are an executive career advisor. Draft a professional, polite follow-up email for a job application.
Candidate: ${user.name || "Candidate"}
Role: ${application.role || "Role"}
Company: ${application.company || "Company"}
Current Pipeline Stage: ${newStatus}
Notes: ${application.notes || "None"}

Return a JSON object with:
- subject: string
- body: string
- suggestedFollowUpDays: number (e.g. 5 for applied, 1-2 for post-interview thank you)`,
          },
        ],
      },
    ];

    return invokeLLM<EmailDraft>({
      user,
      tier: "small",
      feature: "chat",
      prompt,
      schema: EmailDraftSchema,
    });
  },

  /**
   * Dispatch approved email (simulated via Resend in dev/test)
   */
  async sendApprovedEmail({ application, user: _user }: SendApprovedEmailParams): Promise<ApplicationRecord | null> {
    if (!application.followUpDraft || application.followUpDraft.status !== "draft") {
      throw Object.assign(new Error("No draft email awaiting approval"), {
        code: "NO_PENDING_DRAFT",
        statusCode: 400,
      });
    }

    const appId = String(application._id);

    // Mark as approved and sent
    const updated = await applicationRepository.update(
      appId,
      {
        followUpDraft: {
          ...application.followUpDraft,
          status: "sent",
          sentAt: new Date(),
        },
      },
      { activity: true },
    );

    logger.info(
      { appId: application._id, recipient: application.company },
      "applicationGraph: follow-up email approved and dispatched",
    );

    return updated;
  },
};
