import { giftExportRouteDependencies } from "@/composition/gift-export";
import { handleGiftExport } from "@/modules/gifts/presentation/gift-export-route-handler";

type RouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

export function GET(request: Request, routeContext: RouteContext): Promise<Response> {
  return handleGiftExport(request, routeContext, giftExportRouteDependencies);
}
