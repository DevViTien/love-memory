import { getMediaService } from "@/composition/media";
import { scheduleMediaProcessing } from "@/modules/media/infrastructure/media-job-scheduler";
import { handleCompleteMediaUpload } from "@/modules/media/presentation/media-route-handlers";

export function POST(request: Request): Promise<Response> {
  return handleCompleteMediaUpload(request, {
    getService: getMediaService,
    scheduleProcessing: () => scheduleMediaProcessing("upload-complete"),
  });
}
