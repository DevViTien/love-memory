import { checkoutService } from "@/composition/billing";
import { handleGetOrder } from "@/modules/billing/presentation/billing-route-handlers";

type OrderRouteContext = Readonly<{ params: Promise<{ orderId: string }> }>;

export function GET(request: Request, routeContext: OrderRouteContext): Promise<Response> {
  return handleGetOrder(request, routeContext, { service: () => checkoutService });
}
