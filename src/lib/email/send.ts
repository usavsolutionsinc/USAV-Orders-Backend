/**
 * Tiny transactional-email shim.
 *
 * Production: posts to Resend (https://resend.com) when RESEND_API_KEY is
 * set. Resend chosen because it's the lowest-friction modern transactional
 * provider and works from any runtime — no SMTP server, no SDK install.
 *
 * Dev/CI: logs to console and returns ok=true. Lets tests and local runs
 * exercise the email send sites without provisioning a real account.
 *
 * Adding nodemailer/SMTP as a second backend is a small change in
 * `send()` if a customer needs it (add the `nodemailer` dep back first).
 */

import { PRODUCT_NAME } from '@/lib/branding/constants';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Used as From: header. Falls back to EMAIL_FROM env, then a localhost stub. */
  from?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

function defaultFrom(): string {
  return (
    process.env.EMAIL_FROM ||
    `${PRODUCT_NAME} <onboarding@localhost>`
  );
}

async function sendViaResend(msg: EmailMessage): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY!;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: msg.from || defaultFrom(),
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
      }),
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  if (process.env.RESEND_API_KEY) return sendViaResend(msg);
  // Dev/CI fallback. We log enough to make debugging easy without dumping
  // the entire body into the terminal.
  console.info(
    `[email] (stub) to=${msg.to} subject="${msg.subject}" length=${msg.text.length}`,
  );
  return { ok: true, id: 'stub' };
}

/** Convenience: send + swallow errors with a warn. Use inside fire-and-forget paths. */
export async function sendEmailBestEffort(msg: EmailMessage): Promise<void> {
  const result = await sendEmail(msg);
  if (!result.ok) {
    console.warn(`[email] send failed to ${msg.to}: ${result.error}`);
  }
}
