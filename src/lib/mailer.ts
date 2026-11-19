import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { environment } from "@/config/environment";

/**
 * Transactional email delivery via NodeMailer (SMTP).
 *
 * Server-side only. The transporter is created lazily and cached for the
 * process lifetime - creating one per request wastes TCP handshakes. All
 * failures are logged server-side and surfaced as a generic error to the
 * caller; no SMTP credentials or provider messages ever reach the client.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (!environment.smtp.isConfigured) {
    throw new Error(
      "SMTP is not configured - set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in .env.local.",
    );
  }

  transporter = nodemailer.createTransport({
    host: environment.smtp.host,
    port: environment.smtp.port,
    secure: environment.smtp.port === 465,
    auth: {
      user: environment.smtp.user,
      pass: environment.smtp.pass,
    },
  });

  return transporter;
}

interface SendOtpEmailOptions {
  to: string;
  otp: string;
  name: string;
}

/**
 * Sends the patient signup verification OTP. Throws on transport failure so
 * the caller can decide whether to surface a generic error.
 */
export async function sendOtpEmail(options: SendOtpEmailOptions): Promise<void> {
  const mailer = getTransporter();

  await mailer.sendMail({
    from: environment.smtp.from,
    to: options.to,
    subject: "Your verification code",
    text: [
      `Hi ${options.name},`,
      "",
      `Your verification code is: ${options.otp}`,
      "",
      "This code expires in 10 minutes. If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(options.name)},</p>`,
      `<p>Your verification code is:</p>`,
      `<p style="font-size:1.5rem;font-weight:700;letter-spacing:0.25em;">${escapeHtml(options.otp)}</p>`,
      `<p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
    ].join("\n"),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
