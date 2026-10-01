import { describe, expect, it } from "vitest";

import { chooseRestartMode, RESTART_URL_MARGIN_MS } from "./preview-restart";

const now = Date.parse("2026-10-01T10:00:00.000Z");

function expiringIn(ms: number) {
  return { assetsExpireAt: new Date(now + ms).toISOString() };
}

describe("chooseRestartMode", () => {
  it("restarts in the browser when there is no URL to expire", () => {
    expect(chooseRestartMode({ assetsExpireAt: null }, now)).toBe("client");
  });

  it("restarts in the browser while the URLs stay valid for more than 60 seconds", () => {
    expect(RESTART_URL_MARGIN_MS).toBe(60_000);
    expect(chooseRestartMode(expiringIn(240_000), now)).toBe("client");
    expect(chooseRestartMode(expiringIn(60_001), now)).toBe("client");
  });

  it("re-reads from the server at or below the margin, and after expiry", () => {
    expect(chooseRestartMode(expiringIn(60_000), now)).toBe("server");
    expect(chooseRestartMode(expiringIn(59_000), now)).toBe("server");
    expect(chooseRestartMode(expiringIn(-1_000), now)).toBe("server");
  });

  it("treats an unreadable expiry as expired", () => {
    expect(chooseRestartMode({ assetsExpireAt: "not-a-date" }, now)).toBe("server");
  });
});
