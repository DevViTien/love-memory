import { checkoutService } from "@/composition/billing";
import { handleStartCheckout } from "@/modules/billing/presentation/billing-route-handlers";

type CheckoutRouteContext = Readonly<{ params: Promise<{ publicId: string }> }>;

export function POST(request: Request, routeContext: CheckoutRouteContext): Promise<Response> {
  return handleStartCheckout(request, routeContext, { service: () => checkoutService });
}
