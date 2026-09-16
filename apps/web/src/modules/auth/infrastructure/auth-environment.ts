import "server-only";

import { z } from "zod";

const emailFromSchema = z.string().refine((value) => {
  const bracketMatch = /<([^>]+)>$/.exec(value);
  return z.email().safeParse(bracketMatch?.[1] ?? value).success;
}, "Expected an email address or Name <email@example.com>.");

const AuthEnvironmentSchema = z
  .object({
    APP_URL: z.url().optional(),
    AUTH_EMAIL_FROM: emailFromSchema,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    RESEND_API_KEY: z.string().min(10),
  })
  .transform((environment) => {
    const baseUrl = new URL(environment.BETTER_AUTH_URL ?? environment.APP_URL ?? "");
    const isLoopback = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";

    if (environment.NODE_ENV === "production" && baseUrl.protocol !== "https:" && !isLoopback) {
      throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
    }

    return {
      baseUrl,
      emailFrom: environment.AUTH_EMAIL_FROM,
      isProduction: environment.NODE_ENV === "production",
      resendApiKey: environment.RESEND_API_KEY,
      secret: environment.BETTER_AUTH_SECRET,
    };
  });

export type AuthEnvironment = z.output<typeof AuthEnvironmentSchema>;

export function parseAuthEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): AuthEnvironment {
  return AuthEnvironmentSchema.parse(source);
}

export function getAuthEnvironment(): AuthEnvironment {
  return parseAuthEnvironment(process.env);
}
