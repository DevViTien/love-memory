import { describe, expect, it, vi } from "vitest";

import {
  reportClientBoundaryError,
  reportOperationalFailure,
  reportReadinessFailure,
} from "./operational-errors";

describe("operational error reporting", () => {
  it("does not log database error messages or secrets", () => {
    const sink = { error: vi.fn() };

    reportReadinessFailure(new Error("database-password=secret-value"), "request-1", sink);

    expect(sink.error).toHaveBeenCalledWith("Readiness check failed", {
      errorName: "Error",
      requestId: "request-1",
    });
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain("secret");
  });

  it("reports only safe client boundary metadata", () => {
    const sink = { error: vi.fn() };
    const error = Object.assign(new Error("private gift text"), { digest: "digest-1" });

    reportClientBoundaryError(error, sink);

    expect(sink.error).toHaveBeenCalledWith("Unhandled application error", {
      digest: "digest-1",
      errorName: "Error",
    });
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain("private gift text");
  });

  it("normalizes non-Error failures", () => {
    const sink = { error: vi.fn() };

    reportReadinessFailure("connection failed", "request-2", sink);

    expect(sink.error).toHaveBeenCalledWith("Readiness check failed", {
      errorName: "UnknownError",
      requestId: "request-2",
    });
  });

  it("reports an operation without leaking the error message", () => {
    const sink = { error: vi.fn() };

    reportOperationalFailure("media.complete", new Error("secret URL"), "request-3", sink);

    expect(sink.error).toHaveBeenCalledWith("Operational request failed", {
      errorName: "Error",
      operation: "media.complete",
      requestId: "request-3",
    });
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain("secret URL");
  });
});
