import "server-only";

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Resend } from "resend";

import { type EmailSender } from "../application/system-emails";

type EmailClient = Readonly<{
  emails: Readonly<{
    send(
      input: Readonly<{ from: string; html: string; subject: string; text: string; to: string }>,
      options: Readonly<{ idempotencyKey: string }>,
    ): Promise<Readonly<{ data: unknown; error: Readonly<{ message: string }> | null }>>;
  }>;
}>;

/** Sends through the provider of sign-in emails, which deduplicates on the idempotency key. */
export function createProviderEmailSender(client: EmailClient, from: string): EmailSender {
  return {
    async send({ html, idempotencyKey, subject, text, to }) {
      const { error } = await client.emails.send(
        { from, html, subject, text, to },
        { idempotencyKey },
      );
      // The message is not passed on: it may echo the address.
      if (error) throw new Error("System email delivery failed.");
    },
  };
}

export function createResendEmailSender(apiKey: string, from: string): EmailSender {
  return createProviderEmailSender(new Resend(apiKey), from);
}

type CaptureWriter = (path: string, line: string) => Promise<void>;

const appendLine: CaptureWriter = async (path, line) => {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${line}\n`, { encoding: "utf8" });
};

/** Local development and E2E only (`AUTH_EMAIL_CAPTURE_PATH`, loopback): one JSON line per email. */
export function createCaptureEmailSender(
  path: string,
  writer: CaptureWriter = appendLine,
): EmailSender {
  return {
    send({ kind, subject, text, to }) {
      return writer(path, JSON.stringify({ kind, subject, text, to }));
    },
  };
}
