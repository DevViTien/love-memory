import "server-only";

export type AnalyticsEnvironment =
  | Readonly<{ enabled: false; giftRefSecret: null }>
  | Readonly<{ enabled: true; giftRefSecret: string }>;

export const ANALYTICS_GIFT_REF_SECRET_MIN_LENGTH = 32;

type WarningSink = Pick<Console, "warn">;

let misconfigurationReported = false;

/**
 * First-party funnel analytics. It is on only when `ANALYTICS_ENABLED` is exactly `true` and the
 * dedicated `ANALYTICS_GIFT_REF_SECRET` has at least 32 characters. Anything else reads as off and
 * never throws: the configuration is read per request, so a bad value must never take a page down.
 * A flag set to `true` with an unusable secret is reported once per process, without the value.
 * Unlike the internal publish flag, Production is not forced off here; it is off by default there
 * because the variable is absent (runbook, ADR-0010).
 */
export function parseAnalyticsEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  sink: WarningSink = console,
): AnalyticsEnvironment {
  if (source["ANALYTICS_ENABLED"] !== "true") return { enabled: false, giftRefSecret: null };

  const secret = source["ANALYTICS_GIFT_REF_SECRET"] ?? "";
  if (secret.length >= ANALYTICS_GIFT_REF_SECRET_MIN_LENGTH) {
    return { enabled: true, giftRefSecret: secret };
  }

  if (!misconfigurationReported) {
    misconfigurationReported = true;
    sink.warn(JSON.stringify({ event: "analytics_misconfigured" }));
  }
  return { enabled: false, giftRefSecret: null };
}

export function getAnalyticsEnvironment(): AnalyticsEnvironment {
  return parseAnalyticsEnvironment(process.env);
}
