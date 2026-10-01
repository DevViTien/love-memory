import { eventsRouteDependencies } from "@/composition/analytics";
import { handlePostAnalyticsEvent } from "@/modules/analytics/presentation/events-route-handler";

export function POST(request: Request): Promise<Response> {
  return handlePostAnalyticsEvent(request, eventsRouteDependencies);
}
