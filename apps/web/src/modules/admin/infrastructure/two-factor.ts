import { COLLECTIONS } from "@love-memory/database";
import { type TwoFactorOptions } from "better-auth/plugins";

/**
 * Every HTTP endpoint of Better Auth's `twoFactor` plugin. All of them are disabled
 * (`disabledPaths`): only the guarded admin routes use the factor, on the server, so a stolen
 * session cookie can neither re-enroll nor disable it (`admin-access`). A test compares this list
 * with the plugin's endpoints, so an upgrade that adds one fails until it is listed here.
 */
export const TWO_FACTOR_HTTP_PATHS = [
  "/two-factor/disable",
  "/two-factor/enable",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
  "/two-factor/send-otp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
  "/two-factor/verify-totp",
] as const;

/** TOTP (6 digits, 30 s, issuer `LoveMemory`) and 10 backup codes, for passwordless admins. */
export const TWO_FACTOR_OPTIONS = {
  allowPasswordless: true,
  backupCodeOptions: { amount: 10 },
  issuer: "LoveMemory",
  schema: { twoFactor: { modelName: COLLECTIONS.twoFactors } },
  totpOptions: { digits: 6, period: 30 },
} satisfies TwoFactorOptions;
