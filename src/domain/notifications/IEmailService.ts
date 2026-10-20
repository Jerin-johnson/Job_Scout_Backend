export interface IEmailOptions {
  toEmail: string;
  subject: string;
  html: string;
  fromEmail?: string;
}

export interface IEmailResult {
  success: boolean;
  messageId?: string;
  mock?: boolean;
  error?: string;
}

export interface IEmailService {
  sendEmail(options: IEmailOptions): Promise<IEmailResult>;
}
