import { Resend } from "resend";
import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;
  resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export const emailDigestService = {
  /**
   * Send daily job match digest via Resend
   */
  async sendDailyDigest({ toEmail, candidateName, matches }) {
    if (env.RESEND_API_KEY === "re_dummy_key") {
      logger.debug(
        { toEmail, count: matches.length },
        "Mock Resend mode active; skipping live email dispatch",
      );
      return { success: true, mock: true };
    }

    try {
      const resend = getResendClient();

      const jobListHtml = matches
        .slice(0, 5)
        .map(
          (m) => `
          <div style="border-bottom: 1px solid #e2e8f0; padding: 12px 0;">
            <h3 style="margin: 0; color: #1e293b;">${m.jobDetails?.title || "Role"} - <span style="color: #64748b;">${m.jobDetails?.company || "Company"}</span></h3>
            <p style="margin: 4px 0; color: #10b981; font-weight: bold;">Match Score: ${m.score}%</p>
            <p style="margin: 4px 0; color: #475569;">${m.rationale}</p>
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
        subject: `JobScout: ${matches.length} New Matches Found Today`,
        html,
      });

      return { success: true, result };
    } catch (err) {
      logger.error({ err: err.message, toEmail }, "Failed to send daily digest email via Resend");
      return { success: false, error: err.message };
    }
  },
};
