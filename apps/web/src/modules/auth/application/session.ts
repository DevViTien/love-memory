import "server-only";

import { z } from "zod";

const CurrentUserSchema = z
  .object({
    email: z.email(),
    id: z.string().min(1),
    // Better Auth's magic-link plugin creates passwordless users with an empty
    // name when the sign-in form only asks for an email address.
    name: z.string(),
    role: z.enum(["creator", "admin"]).default("creator"),
    // Set by Better Auth's `twoFactor` plugin once an admin's factor is enabled.
    twoFactorEnabled: z
      .boolean()
      .nullish()
      .transform((enabled) => enabled === true),
  })
  .passthrough();

export type CurrentUser = Readonly<z.output<typeof CurrentUserSchema>>;

const SessionIdSchema = z.object({ id: z.string().min(1) }).passthrough();

export interface SessionProvider {
  getSession(requestHeaders: Headers): Promise<unknown>;
}

export function createSessionService(provider: SessionProvider) {
  async function getCurrentUser(requestHeaders: Headers): Promise<CurrentUser | null> {
    const session = await provider.getSession(requestHeaders);
    if (!session || typeof session !== "object" || !("user" in session)) {
      return null;
    }

    return CurrentUserSchema.parse(session.user);
  }

  async function verifySession(requestHeaders: Headers): Promise<CurrentUser> {
    const user = await getCurrentUser(requestHeaders);
    if (!user) {
      throw new Error("AUTHENTICATION_REQUIRED");
    }

    return user;
  }

  /** The user and the current session's id: what a per-session check (the admin step-up) needs. */
  async function getCurrentSession(
    requestHeaders: Headers,
  ): Promise<Readonly<{ sessionId: string; user: CurrentUser }> | null> {
    const session = await provider.getSession(requestHeaders);
    if (!session || typeof session !== "object" || !("user" in session)) return null;
    const sessionId = SessionIdSchema.safeParse((session as { session?: unknown }).session);
    if (!sessionId.success) return null;
    return { sessionId: sessionId.data.id, user: CurrentUserSchema.parse(session.user) };
  }

  return { getCurrentSession, getCurrentUser, verifySession } as const;
}
