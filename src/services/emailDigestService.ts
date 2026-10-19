import { Resend } from "resend";
import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";

let resendClient: Resend | null = null;

function escapeHtml(value = ""): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char,
  );
}

function getResendClient(): Resend {
  if (resendClient) return resendClient;
  resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export interface ApplicationReminderEmailParams {
  toEmail: string;
  candidateName?: string;
  application: {
    _id?: unknown;
    company?: string;
    role?: string;
    jobUrl?: string | null;
  };
}

export interface DigestMatchItem {
  score?: number;
  rationale?: string;
  missingSkills?: string[];
  jobDetails?: {
    title?: string;
    company?: string;
  };
}

export interface DailyDigestEmailParams {
  toEmail: string;
  candidateName?: string;
  matches?: DigestMatchItem[] | unknown[];
}

export interface EmailDispatchResult {
  success: boolean;
  mock?: boolean;
  result?: unknown;
  error?: string;
}

export const emailDigestService = {
  async sendApplicationReminder({
    toEmail,
    candidateName,
    application,
  }: ApplicationReminderEmailParams): Promise<EmailDispatchResult> {
    if (env.RESEND_API_KEY === "re_dummy_key") {
      logger.info(
        { toEmail, applicationId: application._id },
        "Mock application reminder dispatched",
      );
      return { success: true, mock: true };
    }
    try {
      const company = application.company || "Company";
      const role = application.role || "Role";
      const result = await getResendClient().emails.send({
        from: env.FROM_EMAIL,
        to: toEmail,
        subject: `Follow up with ${company} about ${role}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2>Time for a follow-up</h2><p>Hi ${escapeHtml(candidateName || "there")},</p><p>Your reminder to follow up about <strong>${escapeHtml(role)}</strong> at <strong>${escapeHtml(company)}</strong> is due today.</p>${application.jobUrl ? `<p><a href="${escapeHtml(application.jobUrl)}">Open job posting</a></p>` : ""}<p>Open your JobScout application board to review the contact details and next steps.</p></div>`,
      });
      if (result.error) throw new Error(result.error.message || "Email delivery failed");
      return { success: true, result };
    } catch (cause) {
      const error = cause as Error;
      logger.error({ error: error.message, toEmail }, "Failed to send application reminder");
      return { success: false, error: error.message };
    }
  },

  /**
   * Send daily job match digest via Resend
   */
  async sendDailyDigest({
    toEmail,
    candidateName,
    matches,
  }: DailyDigestEmailParams): Promise<EmailDispatchResult> {
    const matchList = (matches || []) as DigestMatchItem[];
    if (env.RESEND_API_KEY === "re_dummy_key") {
      logger.debug(
        { toEmail, count: matchList.length },
        "Mock Resend mode active; skipping live email dispatch",
      );
      return { success: true, mock: true };
    }

    try {
      const resend = getResendClient();

      const jobListHtml = matchList
        .slice(0, 5)
        .map(
          (m) => `
          <div style="border-bottom: 1px solid #e2e8f0; padding: 12px 0;">
            <h3 style="margin: 0; color: #1e293b;">${m.jobDetails?.title || "Role"} - <span style="color: #64748b;">${m.jobDetails?.company || "Company"}</span></h3>
            <p style="margin: 4px 0; color: #10b981; font-weight: bold;">Match Score: ${m.score ?? 0}%</p>
            <p style="margin: 4px 0; color: #475569;">${m.rationale || ""}</p>
            ${m.missingSkills?.length ? `<p style="margin: 4px 0; font-size: 12px; color: #f59e0b;">Skill Gaps: ${m.missingSkills.join(", ")}</p>` : ""}
          </div>
        `,
        )
        .join("");

      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #334155;">
          <h2 style="color: #2563eb;">Your Daily JobScout Matches</h2>
          <p>Hi ${candidateName || "Candidate"},</p>
          <p>Here are your top-scoring opportunities discovered by JobScout today:</p>
          ${jobListHtml}
          <div style="margin-top: 24px; font-size: 12px; color: #94a3b8;">
            <p>You received this email as part of your JobScout subscription.</p>
            <p><a href="${env.WEB_ORIGIN}/settings/notifications?unsubscribe=true" style="color: #64748b;">Unsubscribe from daily digest</a></p>
          </div>
        </div>
      `;

      const result = await resend.emails.send({
        from: env.FROM_EMAIL,
        to: toEmail,
        subject: `JobScout: ${matchList.length} New Matches Found Today`,
        html,
      });

      return { success: true, result };
    } catch (cause) {
      const err = cause as Error;
      logger.error({ err: err.message, toEmail }, "Failed to send daily digest email via Resend");
      return { success: false, error: err.message };
    }
  },
};
