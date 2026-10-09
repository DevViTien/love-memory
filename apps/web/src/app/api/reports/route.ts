import { reportRouteDependencies } from "@/composition/moderation";
import { handleReport } from "@/modules/moderation/presentation/report-route-handler";

export function POST(request: Request): Promise<Response> {
  return handleReport(request, reportRouteDependencies);
}
