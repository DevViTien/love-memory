import { templateVersionRouteDependencies } from "@/composition/admin";
import { handleTemplateVersionAction } from "@/modules/templates/presentation/template-version-route-handler";

export function POST(request: Request): Promise<Response> {
  return handleTemplateVersionAction(request, templateVersionRouteDependencies);
}
