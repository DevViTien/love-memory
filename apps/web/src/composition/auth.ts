import "server-only";

import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { COLLECTIONS, getDatabase, getMongoClient } from "@love-memory/database";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins";

import { createResendAuthEmailSender } from "@/modules/auth/infrastructure/auth-email-sender";
import { getAuthEnvironment } from "@/modules/auth/infrastructure/auth-environment";

async function createAuth() {
  const environment = getAuthEnvironment();
  const [database, client] = await Promise.all([getDatabase(), getMongoClient()]);
  const emailSender = createResendAuthEmailSender(environment.resendApiKey, environment.emailFrom);

  return betterAuth({
    account: { modelName: COLLECTIONS.accounts },
    advanced: {
      database: { generateId: "uuid", joins: true },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: environment.isProduction,
      },
    },
    baseURL: environment.baseUrl.origin,
    database: mongodbAdapter(database, { client, transaction: true, usePlural: false }),
    plugins: [
      magicLink({
        expiresIn: 600,
        rateLimit: { max: 5, window: 300 },
        sendMagicLink: ({ email, url }) => emailSender.sendMagicLink({ email, url }),
        storeToken: "hashed",
      }),
    ],
    rateLimit: {
      customRules: {
        "/sign-in/magic-link": { max: 5, window: 300 },
      },
      enabled: true,
      max: 60,
      modelName: COLLECTIONS.authRateLimits,
      storage: "database",
      window: 60,
    },
    secret: environment.secret,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      modelName: COLLECTIONS.sessions,
      updateAge: 60 * 60 * 24,
    },
    trustedOrigins: [environment.baseUrl.origin],
    user: {
      additionalFields: {
        role: {
          defaultValue: "creator",
          input: false,
          required: true,
          type: "string",
        },
      },
      modelName: COLLECTIONS.users,
    },
    verification: { modelName: COLLECTIONS.verifications },
  });
}

type Auth = Awaited<ReturnType<typeof createAuth>>;
let authPromise: Promise<Auth> | undefined;

export function getAuth(): Promise<Auth> {
  authPromise ??= createAuth().catch((error: unknown) => {
    authPromise = undefined;
    throw error;
  });

  return authPromise;
}
