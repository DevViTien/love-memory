import { moderationRouteDependencies } from "@/composition/moderation";
import { handleModerationAction } from "@/modules/moderation/presentation/moderation-route-handler";

type RouteContext = Readonly<{ params: Promise<{ reportId: string }> }>;

export function POST(request: Request, routeContext: RouteContext): Promise<Response> {
  return handleModerationAction(request, routeContext, moderationRouteDependencies);
}
