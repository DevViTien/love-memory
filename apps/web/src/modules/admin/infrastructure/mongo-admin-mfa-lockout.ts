import { COLLECTIONS, getDatabase } from "@love-memory/database";

import {
  ADMIN_MFA_LOCK_MILLISECONDS,
  ADMIN_MFA_MAX_FAILED_ATTEMPTS,
  type AdminMfaLockout,
} from "../application/admin-mfa";
import { authIdFilter } from "./better-auth-ids";

/**
 * The fields of the `twoFactor` plugin's own record that it uses for its sign-in lockout. Keeping
 * the step-up lockout there means one lock per factor, and `admin:reset-mfa` clears both.
 */
type TwoFactorLockDocument = Readonly<{
  failedVerificationCount?: number | null;
  lockedUntil?: Date | null;
}>;

async function twoFactors() {
  return (await getDatabase()).collection<TwoFactorLockDocument>(COLLECTIONS.twoFactors);
}

export const mongoAdminMfaLockout: AdminMfaLockout = {
  async clear(userId) {
    await (
      await twoFactors()
    ).updateOne(
      { userId: authIdFilter(userId) },
      { $set: { failedVerificationCount: 0, lockedUntil: null } },
    );
  },

  async lockedUntil(userId, now) {
    const factor = await (
      await twoFactors()
    ).findOne(
      { lockedUntil: { $gt: now }, userId: authIdFilter(userId) },
      { projection: { _id: 0, lockedUntil: 1 } },
    );
    return factor?.lockedUntil ?? null;
  },

  async recordFailure(userId, now) {
    const collection = await twoFactors();
    // Atomic, so concurrent failures are all counted; nothing to count before an enrollment.
    const counted = await collection.findOneAndUpdate(
      { userId: authIdFilter(userId) },
      { $inc: { failedVerificationCount: 1 } },
      { projection: { _id: 0, failedVerificationCount: 1 }, returnDocument: "after" },
    );
    if ((counted?.failedVerificationCount ?? 0) < ADMIN_MFA_MAX_FAILED_ATTEMPTS) return;
    // The lock starts a fresh budget for when it ends.
    await collection.updateOne(
      {
        failedVerificationCount: { $gte: ADMIN_MFA_MAX_FAILED_ATTEMPTS },
        userId: authIdFilter(userId),
      },
      {
        $set: {
          failedVerificationCount: 0,
          lockedUntil: new Date(now.getTime() + ADMIN_MFA_LOCK_MILLISECONDS),
        },
      },
    );
  },
};
