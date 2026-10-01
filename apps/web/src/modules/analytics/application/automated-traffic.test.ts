import { describe, expect, it } from "vitest";

import { AUTOMATED_USER_AGENT_SUBSTRINGS, isAutomatedUserAgent } from "./automated-traffic";

const REAL_BROWSERS = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  playwrightDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.6668.29 Safari/537.36",
  playwrightPixel:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.29 Mobile Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  zaloInApp:
    "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36 Zalo android/12100682 ZaloTheme/light ZaloLanguage/vn",
} as const;

describe("automated traffic", () => {
  it.each(AUTOMATED_USER_AGENT_SUBSTRINGS)("treats %s in any case as automated", (substring) => {
    expect(isAutomatedUserAgent(`Mozilla/5.0 (${substring})`)).toBe(true);
    expect(isAutomatedUserAgent(`Mozilla/5.0 (${substring.toUpperCase()})`)).toBe(true);
  });

  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (compatible; Discordbot/2.0)",
    "curl/8.4.0",
  ])("treats the crawler or tool %s as automated", (userAgent) => {
    expect(isAutomatedUserAgent(userAgent)).toBe(true);
  });

  it.each([null, undefined, "", "   "])(
    "treats a missing or empty header (%o) as automated",
    (value) => {
      expect(isAutomatedUserAgent(value)).toBe(true);
    },
  );

  it.each(Object.entries(REAL_BROWSERS))("lets the real browser %s through", (_name, userAgent) => {
    expect(isAutomatedUserAgent(userAgent)).toBe(false);
  });

  it("drops a real CUBOT phone too, the accepted loss of a substring match", () => {
    expect(
      isAutomatedUserAgent(
        "Mozilla/5.0 (Linux; Android 12; CUBOT KINGKONG 7) AppleWebKit/537.36 Chrome/120 Mobile",
      ),
    ).toBe(true);
  });
});
