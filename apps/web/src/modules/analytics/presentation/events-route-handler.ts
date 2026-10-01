import { AnalyticsEventRequestSchema, API_ERROR_CODES } from "@love-memory/contracts";

import {
  createApiErrorResponse,
  createInvalidBodyResponse,
  createRateLimitedResponse,
  readJsonBody,
  requestId,
  validateJsonMutationRequest,
} from "@/http/api-response";
import { reportOperationalFailure } from "@/observability/operational-errors";

import { type AnalyticsService } from "../application/analytics-service";
import { isAutomatedUserAgent } from "../application/automated-traffic";

/** One event is about 250 bytes; anything above this is not a funnel event. */
export const ANALYTICS_EVENT_MAX_BYTES = 2048;

export type AnalyticsRateLimitScope = "analytics-event" | "analytics-event-ip";

export type EventsRouteDependencies = Readonly<{
  /** Charges one counter (keyed, hashed subject); wired in `composition/analytics.ts`. */
  consumeRateLimit: (
    scope: AnalyticsRateLimitScope,
    subject: string,
  ) => Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>>;
  getService: () => Pick<AnalyticsService, "recordBrowserEvent">;
  /** Read per request: a disabled or misconfigured setup answers `204` and stores nothing. */
  isEnabled: () => boolean;
  /** The network subject (IPv4, IPv6 `/64` or `unidentified`); never a cookie or session. */
  networkSubject: (request: Request) => string;
  now?: () => Date;
  /** The per-session counter subject: the network subject qualified by the body's session id. */
  sessionSubject: (networkSubject: string, sessionId: string) => string;
}>;

function internalError(id: string): Response {
  return createApiErrorResponse({
    code: API_ERROR_CODES.internal,
    message: "The event could not be stored.",
    requestId: id,
    status: 500,
  });
}

function noContent(id: string): Response {
  return new Response(null, {
    headers: { "Cache-Control": "no-store", "x-request-id": id },
    status: 204,
  });
}

/**
 * `POST /api/events`: media type and origin, then the silent `204` for disabled analytics and
 * automated traffic, then the capped body and its strict schema, then two rate-limit counters,
 * then one insert. The body is parsed before the counters on purpose: it is capped at 2 KiB, and
 * the per-session counter needs the validated session id. Failures log only an operation name and
 * the request id, never the body.
 */
export async function handlePostAnalyticsEvent(
  request: Request,
  dependencies: EventsRouteDependencies,
): Promise<Response> {
  const id = requestId(request);

  try {
    const rejected = validateJsonMutationRequest(request, id);
    if (rejected) return rejected;

    if (!dependencies.isEnabled()) return noContent(id);
    if (isAutomatedUserAgent(request.headers.get("user-agent"))) return noContent(id);

    const body = await readJsonBody(request, AnalyticsEventRequestSchema, {
      maxBytes: ANALYTICS_EVENT_MAX_BYTES,
    });
    if (!body.ok) return createInvalidBodyResponse(body.error, id);

    const network = dependencies.networkSubject(request);
    let limit: Awaited<ReturnType<EventsRouteDependencies["consumeRateLimit"]>>;
    try {
      limit = await dependencies.consumeRateLimit(
        "analytics-event",
        dependencies.sessionSubject(network, body.data.sessionId),
      );
      if (limit.allowed) {
        limit = await dependencies.consumeRateLimit("analytics-event-ip", network);
      }
    } catch (error) {
      // A rate-limit store failure is told apart from an event store failure in the log.
      reportOperationalFailure("analytics_event_rate_limit", error, id);
      return internalError(id);
    }
    if (!limit.allowed) return createRateLimitedResponse(limit.retryAfterSeconds, id);

    await dependencies
      .getService()
      .recordBrowserEvent(body.data, (dependencies.now ?? (() => new Date()))());
    return noContent(id);
  } catch (error) {
    reportOperationalFailure("analytics_event_store", error, id);
    return internalError(id);
  }
}
