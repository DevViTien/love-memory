import "server-only";

import { z } from "zod";

const emailFromSchema = z.string().refine((value) => {
  const bracketMatch = /<([^>]+)>$/.exec(value);
  return z.email().safeParse(bracketMatch?.[1] ?? value).success;
}, "Expected an email address or Name <email@example.com>.");

const SystemEmailEnvironmentSchema = z
  .object({
    APP_URL: z.url(),
    AUTH_EMAIL_CAPTURE_PATH: z.string().min(1).optional(),
    AUTH_EMAIL_FROM: emailFromSchema,
    RESEND_API_KEY: z.string().min(10),
  })
  .transform((environment) => {
    const appUrl = new URL(environment.APP_URL);
    const isLoopback = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1";
    if (environment.AUTH_EMAIL_CAPTURE_PATH && !isLoopback) {
      throw new Error("AUTH_EMAIL_CAPTURE_PATH is allowed only for loopback test environments.");
    }
    return {
      appUrl,
      capturePath: environment.AUTH_EMAIL_CAPTURE_PATH ?? null,
      emailFrom: environment.AUTH_EMAIL_FROM,
      resendApiKey: environment.RESEND_API_KEY,
    };
  });

export type SystemEmailEnvironment = z.output<typeof SystemEmailEnvironmentSchema>;

/**
 * System emails (`system-emails`): the sign-in email provider and sender, and the public origin
 * for Studio links. Read when a job runs, so the Trigger.dev environment needs these variables but
 * never the auth secret.
 */
export function parseSystemEmailEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): SystemEmailEnvironment {
  return SystemEmailEnvironmentSchema.parse(source);
}

export function getSystemEmailEnvironment(): SystemEmailEnvironment {
  return parseSystemEmailEnvironment(process.env);
}
