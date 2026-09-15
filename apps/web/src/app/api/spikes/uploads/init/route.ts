import { getMediaSpikeService } from "@/composition/media";
import { getTechnicalSpikeEnvironment } from "@/config/technical-spikes";
import { handleInitializeUpload } from "@/modules/media/presentation/upload-route-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleInitializeUpload(request, {
    environment: getTechnicalSpikeEnvironment(),
    getService: getMediaSpikeService,
  });
}
