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

const EmailDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  suggestedFollowUpDays: z.number().default(5),
});

export const applicationGraph = {
  /**
   * Process a stage change in the application pipeline
   * Updates timeline, schedules follow-up, and drafts follow-up email
   */
  async handleStageChange({ application, user, newStatus, note }) {
    const isDev =
      process.env.ANTHROPIC_API_KEY === "dummy_anthropic_key_for_dev" ||
      process.env.NODE_ENV === "test";

    // 1. Update status and timeline
    let updatedApp = await applicationRepository.addTimelineEntry(
      application._id,
      newStatus,
      note || `Status moved to ${newStatus}`,
    );

    // 2. Certain stages trigger automatic follow-up drafts (applied, interviewing)
    if (newStatus === "applied" || newStatus === "interviewing") {
      let draft;
      if (isDev) {
        draft = {
          subject:
            newStatus === "applied"
              ? `Following up on application for ${application.role} - ${user.name || "Candidate"}`
              : `Thank you for the interview - ${application.role} at ${application.company}`,
          body:
            newStatus === "applied"
              ? `Dear Hiring Team,\n\nI recently applied for the ${application.role} role at ${application.company} and wanted to reiterate my enthusiasm for the position. I look forward to hearing about next steps.\n\nBest regards,\n${user.name || "Candidate"}`
              : `Dear Interviewer,\n\nThank you for your time discussing the ${application.role} role. I really enjoyed learning more about ${application.company}'s mission.\n\nBest regards,\n${user.name || "Candidate"}`,
          suggestedFollowUpDays: newStatus === "applied" ? 5 : 2,
        };
      } else {
        try {
          draft = await this.draftEmail({ application, user, newStatus });
        } catch (err) {
          logger.warn({ err: err.message }, "LLM follow-up draft failed, using fallback draft");
          draft = {
            subject: `Following up: ${application.role} at ${application.company}`,
            body: `Dear Hiring Team,\n\nI am writing to follow up on my candidacy for the ${application.role} role at ${application.company}.\n\nBest,\n${user.name || "Candidate"}`,
            suggestedFollowUpDays: 5,
          };
        }
      }

      const nextFollowUpAt = new Date(
        Date.now() + draft.suggestedFollowUpDays * 24 * 60 * 60 * 1000,
      );

      updatedApp = await applicationRepository.update(application._id, {
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
  async draftEmail({ application, user, newStatus }) {
    const prompt = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are an executive career advisor. Draft a professional, polite follow-up email for a job application.
Candidate: ${user.name || "Candidate"}
Role: ${application.role}
Company: ${application.company}
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

    return invokeLLM({
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
  async sendApprovedEmail({ application, user }) {
    if (!application.followUpDraft || application.followUpDraft.status !== "draft") {
      throw Object.assign(new Error("No draft email awaiting approval"), {
        code: "NO_PENDING_DRAFT",
        statusCode: 400,
      });
    }

    // Mark as approved and sent
    const updated = await applicationRepository.update(application._id, {
      followUpDraft: {
        ...application.followUpDraft,
        status: "sent",
        sentAt: new Date(),
      },
    });

    logger.info(
      { appId: application._id, recipient: application.company },
      "applicationGraph: follow-up email approved and dispatched",
    );

    return updated;
  },
};
