import { getMediaService } from "@/composition/media";
import { handleListMediaAssets } from "@/modules/media/presentation/media-route-handlers";

export function GET(request: Request): Promise<Response> {
  return handleListMediaAssets(request, { getService: getMediaService });
}
