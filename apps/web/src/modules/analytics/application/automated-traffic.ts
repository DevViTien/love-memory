/**
 * Substrings of declared crawlers, link-preview fetchers and tools (`funnel-analytics` "Automated
 * traffic exclusion"). `headless` is deliberately absent: Playwright's Chromium reports
 * `HeadlessChrome`, and the E2E exercises the real path.
 */
export const AUTOMATED_USER_AGENT_SUBSTRINGS = [
  "bot",
  "crawler",
  "spider",
  "slurp",
  "facebookexternalhit",
  "facebookcatalog",
  "embedly",
  "whatsapp",
  "skypeuripreview",
  "lighthouse",
  "curl/",
  "wget/",
  "python-requests",
] as const;

/**
 * Whether a request's `User-Agent` marks automated traffic. A missing or empty header counts as
 * automated. A plain substring match also drops a few real browsers (a `CUBOT` phone), an accepted
 * loss next to missing real bots.
 */
export function isAutomatedUserAgent(userAgent: string | null | undefined): boolean {
  const normalized = userAgent?.trim().toLowerCase() ?? "";
  if (normalized === "") return true;
  return AUTOMATED_USER_AGENT_SUBSTRINGS.some((substring) => normalized.includes(substring));
}
