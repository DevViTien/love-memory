import { getMediaService } from "@/composition/media";
import { scheduleMediaProcessing } from "@/modules/media/infrastructure/media-job-scheduler";
import { handleRetryMediaAsset } from "@/modules/media/presentation/media-route-handlers";

type Context = Readonly<{ params: Promise<{ assetId: string }> }>;

export async function POST(request: Request, context: Context): Promise<Response> {
  return handleRetryMediaAsset(request, (await context.params).assetId, {
    getService: getMediaService,
    scheduleProcessing: () => scheduleMediaProcessing("retry"),
  });
}
