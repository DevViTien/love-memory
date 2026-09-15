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
