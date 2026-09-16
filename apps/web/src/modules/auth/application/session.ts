import "server-only";

import { z } from "zod";

const CurrentUserSchema = z
  .object({
    email: z.email(),
    id: z.string().min(1),
    name: z.string().min(1),
    role: z.enum(["creator", "admin"]).default("creator"),
  })
  .passthrough();

export type CurrentUser = Readonly<z.output<typeof CurrentUserSchema>>;

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

  return { getCurrentUser, verifySession } as const;
}

export function canManageOwner(user: CurrentUser, ownerId: string): boolean {
  return user.role === "admin" || user.id === ownerId;
}
