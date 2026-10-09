import { giftLifecycleRouteDependencies } from "@/composition/gifts";
import { handleGiftLifecycle } from "@/modules/gifts/presentation/gift-lifecycle-route-handler";

type RouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

export function POST(request: Request, routeContext: RouteContext): Promise<Response> {
  return handleGiftLifecycle("delete", request, routeContext, giftLifecycleRouteDependencies);
}
