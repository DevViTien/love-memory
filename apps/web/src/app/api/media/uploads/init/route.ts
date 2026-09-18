import { getMediaService } from "@/composition/media";
import { handleInitializeMediaUpload } from "@/modules/media/presentation/media-route-handlers";

export function POST(request: Request): Promise<Response> {
  return handleInitializeMediaUpload(request, { getService: getMediaService });
}
