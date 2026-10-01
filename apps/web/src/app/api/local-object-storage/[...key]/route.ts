import { getLocalObjectStorageRoute } from "@/composition/media";
import {
  handleLocalObjectDownload,
  handleLocalObjectUpload,
} from "@/modules/media/presentation/local-object-storage-handlers";

// Only GET and PUT are exported. Next.js answers POST, PATCH and DELETE with 405, OPTIONS with 204
// and `Allow: GET, HEAD, OPTIONS, PUT`, and routes HEAD to GET, where signatures never match.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = Readonly<{ params: Promise<{ key: string[] }> }>;

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleLocalObjectDownload(request, (await context.params).key, {
    getStorage: getLocalObjectStorageRoute,
  });
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  return handleLocalObjectUpload(request, (await context.params).key, {
    getStorage: getLocalObjectStorageRoute,
  });
}
