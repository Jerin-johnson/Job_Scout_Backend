/**
 * Generates the JobScout branded HTML email containing the 6-digit OTP verification code.
 */
export function generateOtpEmailHtml(userName: string, otp: string): string {
  const safeName = userName?.trim() || "JobScout User";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your JobScout Verification Code</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f7f8fb;
      margin: 0;
      padding: 0;
      color: #14213d;
    }
    .wrapper {
      max-width: 560px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(20, 33, 61, 0.05);
    }
    .header {
      background-color: #14213d;
      padding: 32px 40px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .content {
      padding: 40px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 600;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .text {
      font-size: 15px;
      line-height: 1.6;
      color: #4b5563;
      margin-bottom: 24px;
    }
    .otp-container {
      background-color: #edf2ff;
      border: 1px solid #d0ddff;
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      margin: 32px 0;
    }
    .otp-code {
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 0.25em;
      color: #1a4084;
      font-family: monospace;
      margin: 0;
    }
    .otp-expiry {
      font-size: 13px;
      color: #6b7280;
      margin-top: 8px;
      margin-bottom: 0;
    }
    .footer {
      border-top: 1px solid #e5e7eb;
      padding: 24px 40px;
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
      background-color: #f9fafb;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>JobScout</h1>
    </div>
    <div class="content">
      <p class="greeting">Hi ${safeName},</p>
      <p class="text">
        Welcome to JobScout. To complete your registration and secure your account, please enter the 6-digit verification code below:
      </p>
      <div class="otp-container">
        <p class="otp-code">${otp}</p>
        <p class="otp-expiry">This code will expire in 10 minutes.</p>
      </div>
      <p class="text">
        If you didn't create an account with JobScout, you can safely ignore this email.
      </p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} JobScout. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}
