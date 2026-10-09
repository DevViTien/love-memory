import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { type AdminFactorProvider } from "../application/admin-mfa";

/** The server-side `twoFactor` endpoints the admin routes call; their HTTP paths are disabled. */
export type TwoFactorServerApi = Readonly<{
  enableTwoFactor: (input: { body: { method: "totp" }; headers: Headers }) => Promise<unknown>;
  getSession: (input: { headers: Headers }) => Promise<unknown>;
  verifyBackupCode: (input: {
    body: { code: string };
    headers: Headers;
    returnHeaders: true;
  }) => Promise<Readonly<{ headers: Headers }>>;
  verifyTOTP: (input: {
    body: { code: string };
    headers: Headers;
    returnHeaders: true;
  }) => Promise<Readonly<{ headers: Headers }>>;
}>;

const EnabledFactorSchema = z.object({
  backupCodes: z.array(z.string().min(1)).min(1),
  totpURI: z.string().startsWith("otpauth://totp/"),
});

const SessionIdSchema = z.object({ session: z.object({ id: z.string().min(1) }) });

/** A wrong code, an unknown factor or a code of the wrong shape: the plugin's `400` and `401`. */
function isRefusedCode(error: unknown): boolean {
  return isAPIError(error) && (error.statusCode === 400 || error.statusCode === 401);
}

/** `name=value` pairs of the `Set-Cookie` values, as a request `Cookie` header would carry them. */
function cookieHeaderOf(setCookies: readonly string[]): string {
  return setCookies.map((value) => value.split(";", 1)[0]?.trim() ?? "").join("; ");
}

export function createBetterAuthAdminFactor(
  getApi: () => Promise<TwoFactorServerApi>,
): AdminFactorProvider {
  /**
   * The first code of an enrollment makes the plugin replace the session (new cookie, old session
   * deleted), so the step-up must belong to the session in the new cookie.
   */
  async function sessionAfter(
    api: TwoFactorServerApi,
    setCookies: readonly string[],
    currentSessionId: string,
  ): Promise<string> {
    if (setCookies.length === 0) return currentSessionId;
    const rotated = SessionIdSchema.safeParse(
      await api.getSession({ headers: new Headers({ cookie: cookieHeaderOf(setCookies) }) }),
    );
    return rotated.success ? rotated.data.session.id : currentSessionId;
  }

  return {
    async enable(headers) {
      const api = await getApi();
      const enabled = EnabledFactorSchema.parse(
        await api.enableTwoFactor({ body: { method: "totp" }, headers }),
      );
      return { backupCodes: enabled.backupCodes, totpUri: enabled.totpURI };
    },

    async verify({ code, headers, method, sessionId }) {
      const api = await getApi();
      const input = { body: { code }, headers, returnHeaders: true } as const;
      let responseHeaders: Headers;
      try {
        ({ headers: responseHeaders } =
          method === "totp" ? await api.verifyTOTP(input) : await api.verifyBackupCode(input));
      } catch (error) {
        if (isRefusedCode(error)) return { ok: false };
        throw error;
      }
      const setCookies = responseHeaders.getSetCookie();
      return {
        ok: true,
        sessionId: await sessionAfter(api, setCookies, sessionId),
        setCookies,
      };
    },
  };
}
