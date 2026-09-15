import { describe, expect, it, vi } from "vitest";

import { handleMongoSpike } from "./mongo-spike-route-handler";

const token = "a-development-token-with-32-characters";

function createRequest() {
  return new Request("https://example.test/api/spikes/mongodb", {
    headers: { authorization: `Bearer ${token}` },
    method: "POST",
  });
}

describe("MongoDB spike route", () => {
  it("returns the verified read/write/pool result", async () => {
    const response = await handleMongoSpike(createRequest(), {
      environment: { enabled: true, token },
      runProbe: () =>
        Promise.resolve({ connectionReused: true, readVerified: true, writeVerified: true }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { connectionReused: true } });
  });

  it("returns a safe unavailable response when verification fails", async () => {
    const reportFailure = vi.fn();
    const response = await handleMongoSpike(createRequest(), {
      environment: { enabled: true, token },
      reportFailure,
      runProbe: () =>
        Promise.resolve({ connectionReused: true, readVerified: false, writeVerified: true }),
    });

    expect(response.status).toBe(503);
    expect(reportFailure).toHaveBeenCalledOnce();
  });
});
