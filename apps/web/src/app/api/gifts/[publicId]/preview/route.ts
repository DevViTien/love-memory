import { getPreviewService } from "@/composition/preview";
import { handleCreateGiftPreview } from "@/modules/preview/presentation/preview-route-handler";

type PreviewRouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

export function POST(request: Request, routeContext: PreviewRouteContext): Promise<Response> {
  return handleCreateGiftPreview(request, routeContext, { getService: getPreviewService });
}
