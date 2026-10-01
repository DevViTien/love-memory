import { consumePublicReadRateLimit, getPublicGiftService } from "@/composition/public-gifts";
import { handleGetPublicGift } from "@/modules/public-gifts/presentation/public-gift-route-handler";

type PublicGiftRouteContext = Readonly<{ params: Promise<{ shareId: string }> }>;

export function GET(request: Request, routeContext: PublicGiftRouteContext): Promise<Response> {
  return handleGetPublicGift(request, routeContext, {
    consumeRateLimit: consumePublicReadRateLimit,
    getService: getPublicGiftService,
  });
}
