type ErrorLogSink = Pick<Console, "error">;

function toErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function reportOperationalFailure(
  operation: string,
  error: unknown,
  requestId: string,
  sink: ErrorLogSink = console,
): void {
  sink.error("Operational request failed", {
    errorName: toErrorName(error),
    operation,
    requestId,
  });
}

/**
 * A background job failure (`background-jobs`): the job id, type, attempts and error code only,
 * never the payload, an error message or gift content.
 */
export function reportJobFailure(
  entry: Readonly<{ attempts: number; code: string; jobId: string; type: string }>,
  sink: ErrorLogSink = console,
): void {
  sink.error("Job failed", {
    attempts: entry.attempts,
    code: entry.code,
    jobId: entry.jobId,
    type: entry.type,
  });
}

export function reportReadinessFailure(
  error: unknown,
  requestId: string,
  sink: ErrorLogSink = console,
): void {
  sink.error("Readiness check failed", {
    errorName: toErrorName(error),
    requestId,
  });
}

export function reportClientBoundaryError(
  error: Error & { digest?: string },
  sink: ErrorLogSink = console,
): void {
  sink.error("Unhandled application error", {
    digest: error.digest,
    errorName: error.name,
  });
}
