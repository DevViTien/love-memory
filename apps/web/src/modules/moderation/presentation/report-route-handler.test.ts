import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AbuseReportService } from "../application/abuse-reports";
import { handleReport, type ReportRouteDependencies } from "./report-route-handler";

const shareId = "Ab0_-cdefghijklmnopqrs";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/reports", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "user-agent": "Mozilla/5.0",
      "x-request-id": "request-1",
      ...headers,
    },
    method: "POST",
  });
}

describe("POST /api/reports", () => {
  const submit = vi.fn<AbuseReportService["submit"]>();
  const consumeRateLimit = vi.fn<ReportRouteDependencies["consumeRateLimit"]>();
  const dependencies: ReportRouteDependencies = {
    consumeRateLimit,
    isAutomated: (userAgent) => !userAgent || userAgent.includes("bot"),
    linkSubject: (network, id) => `${network}|share:${id}`,
    networkSubject: () => "ip:203.0.113.7",
    service: { submit },
  };
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    submit.mockResolvedValue("received");
  });

  it("answers 202 after the per-link and per-network limits (Recipient reports a gift)", async () => {
    const response = await handleReport(
      post({ category: "harassment", details: "Ảnh xúc phạm", shareId }),
      dependencies,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { received: true } });
    expect(consumeRateLimit.mock.calls).toEqual([
      ["abuse-report", `ip:203.0.113.7|share:${shareId}`],
      ["abuse-report-ip", "ip:203.0.113.7"],
    ]);
    expect(submit).toHaveBeenCalledWith({
      category: "harassment",
      details: "Ảnh xúc phạm",
      shareId,
    });
  });

  it("answers automated traffic with 202 and stores nothing", async () => {
    const response = await handleReport(
      post({ category: "spam", shareId }, { "user-agent": "examplebot/1.0" }),
      dependencies,
    );

    expect(response.status).toBe(202);
    expect(submit).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("answers 404 for a link that does not open", async () => {
    submit.mockResolvedValueOnce("not-found");

    const response = await handleReport(post({ category: "spam", shareId }), dependencies);

    expect(response.status).toBe(404);
  });

  it("answers 429 from either limit before storing (Report spam limited)", async () => {
    consumeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 1200 });
    const perLink = await handleReport(post({ category: "spam", shareId }), dependencies);
    expect(perLink.status).toBe(429);
    expect(perLink.headers.get("retry-after")).toBe("1200");

    consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const perNetwork = await handleReport(post({ category: "spam", shareId }), dependencies);
    expect(perNetwork.status).toBe(429);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses foreign origins, unknown keys and oversized bodies", async () => {
    expect(
      (
        await handleReport(
          post({ category: "spam", shareId }, { origin: "https://attacker.example.test" }),
          dependencies,
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleReport(post({ category: "spam", email: "x@y.z", shareId }), dependencies))
        .status,
    ).toBe(400);
    expect(
      (
        await handleReport(
          post(JSON.stringify({ category: "spam", details: "x".repeat(5000), shareId })),
          dependencies,
        )
      ).status,
    ).toBe(413);
    expect(submit).not.toHaveBeenCalled();
  });

  it("never logs the details or the share id when storing fails", async () => {
    submit.mockRejectedValueOnce(new Error("database down"));

    const response = await handleReport(
      post({ category: "spam", details: "chi tiết riêng", shareId }),
      dependencies,
    );

    expect(response.status).toBe(500);
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/chi tiết riêng|Ab0_-/);
  });
});
