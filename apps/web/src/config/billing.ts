import "server-only";

/** Why checkout is off, for the operations log only; never a credential. */
export type BillingOffReason =
  | "fake-on-vercel"
  | "invalid-app-url"
  | "missing-payos-credentials"
  | "not-configured"
  | "unknown-provider";

export type BillingEnvironment =
  | Readonly<{ appUrl: URL; kind: "fake" }>
  | Readonly<{
      apiKey: string;
      appUrl: URL;
      checksumKey: string;
      clientId: string;
      kind: "payos";
    }>
  | Readonly<{ kind: "off"; reason: BillingOffReason }>;

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value : null;
}

/**
 * `billing-checkout` "Billing provider configuration". It never throws: plan offers read it on every
 * Studio render, so a bad value turns checkout off instead of taking the page down.
 */
export function parseBillingEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): BillingEnvironment {
  const provider = nonEmpty(source["BILLING_PROVIDER"]);
  if (!provider) return { kind: "off", reason: "not-configured" };
  if (provider !== "fake" && provider !== "payos") {
    return { kind: "off", reason: "unknown-provider" };
  }

  let appUrl: URL;
  try {
    appUrl = new URL(source["APP_URL"] ?? "");
  } catch {
    return { kind: "off", reason: "invalid-app-url" };
  }

  if (provider === "fake") {
    // Like the local storage driver: anything but an unset, empty or development VERCEL_ENV is a
    // Vercel deployment, where a provider that accepts any payment must never run.
    const vercelEnv = nonEmpty(source["VERCEL_ENV"]);
    if (vercelEnv && vercelEnv !== "development") return { kind: "off", reason: "fake-on-vercel" };
    return { appUrl, kind: "fake" };
  }

  const clientId = nonEmpty(source["PAYOS_CLIENT_ID"]);
  const apiKey = nonEmpty(source["PAYOS_API_KEY"]);
  const checksumKey = nonEmpty(source["PAYOS_CHECKSUM_KEY"]);
  if (!clientId || !apiKey || !checksumKey) {
    return { kind: "off", reason: "missing-payos-credentials" };
  }
  return { apiKey, appUrl, checksumKey, clientId, kind: "payos" };
}

export function getBillingEnvironment(): BillingEnvironment {
  return parseBillingEnvironment(process.env);
}
