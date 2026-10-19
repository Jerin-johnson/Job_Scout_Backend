import { injectable } from "tsyringe";
import { Resend } from "resend";
import { IEmailService, IEmailOptions, IEmailResult } from "../../domain/notifications/IEmailService.js";
import { env } from "../../config/env.js";
import { logger } from "../../shared/utils/logger.js";

@injectable()
export class ResendEmailService implements IEmailService {
  private resendClient: Resend | null = null;

  private getClient(): Resend {
    if (!this.resendClient) {
      this.resendClient = new Resend(env.RESEND_API_KEY);
    }
    return this.resendClient;
  }

  async sendEmail(options: IEmailOptions): Promise<IEmailResult> {
    if (env.RESEND_API_KEY === "re_dummy_key") {
      logger.info(
        { toEmail: options.toEmail, subject: options.subject },
        "Mock email dispatched via ResendEmailService",
      );
      return { success: true, mock: true };
    }

    try {
      const client = this.getClient();
      const response = await client.emails.send({
        from: options.fromEmail || env.FROM_EMAIL,
        to: options.toEmail,
        subject: options.subject,
        html: options.html,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, toEmail: options.toEmail }, "Failed to send email via Resend");
      return { success: false, error: message };
    }
  }
}
