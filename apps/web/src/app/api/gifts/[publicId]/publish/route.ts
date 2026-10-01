import { giftService } from "@/composition/gifts";
import { handlePublishGift } from "@/modules/gifts/presentation/publish-route-handler";

type PublishRouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

export function POST(request: Request, routeContext: PublishRouteContext): Promise<Response> {
  return handlePublishGift(request, routeContext, { getService: () => giftService });
}
