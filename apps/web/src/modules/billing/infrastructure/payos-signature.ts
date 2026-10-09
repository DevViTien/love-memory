import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * payOS signing rules, as `@payos/node` 2.0.5 implements them (`billing-checkout` "payOS adapter").
 * The test vectors in `payos-signature.test.ts` were computed with that SDK.
 */

function hmacHex(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

/** The signature of a create-payment request: five fields in a fixed order. */
export function signPaymentRequest(
  input: Readonly<{
    amount: number;
    cancelUrl: string;
    description: string;
    orderCode: number;
    returnUrl: string;
  }>,
  checksumKey: string,
): string {
  return hmacHex(
    checksumKey,
    `amount=${input.amount}&cancelUrl=${input.cancelUrl}&description=${input.description}&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`,
  );
}

/**
 * The signature of a response's or a webhook's `data`: keys sorted, `key=value` joined by `&`,
 * `null` as an empty string, arrays as JSON with each element's keys sorted.
 */
export function signData(data: Readonly<Record<string, unknown>>, checksumKey: string): string {
  const query = Object.keys(data)
    .sort()
    .filter((key) => data[key] !== undefined)
    .map((key) => {
      let value = data[key];
      if (Array.isArray(value)) value = JSON.stringify(value.map(sortKeys));
      if (value === null || value === undefined || value === "null" || value === "undefined") {
        value = "";
      }
      return `${key}=${String(value)}`;
    })
    .join("&");
  return hmacHex(checksumKey, query);
}

/** A constant-time check of a hex signature; anything malformed is simply invalid. */
export function isValidDataSignature(
  data: Readonly<Record<string, unknown>>,
  signature: string,
  checksumKey: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signData(data, checksumKey), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
