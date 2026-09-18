import { getMediaService } from "@/composition/media";
import {
  handleDeleteMediaAsset,
  handleGetMediaAsset,
} from "@/modules/media/presentation/media-route-handlers";

type Context = Readonly<{ params: Promise<{ assetId: string }> }>;

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleGetMediaAsset(request, (await context.params).assetId, {
    getService: getMediaService,
  });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return handleDeleteMediaAsset(request, (await context.params).assetId, {
    getService: getMediaService,
  });
}
