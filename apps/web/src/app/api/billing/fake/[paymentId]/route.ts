import { fakeCheckout } from "@/composition/billing";
import { handleFakeCheckoutAction } from "@/modules/billing/presentation/fake-checkout-route-handler";

type FakeCheckoutRouteContext = Readonly<{ params: Promise<{ paymentId: string }> }>;

export function POST(request: Request, routeContext: FakeCheckoutRouteContext): Promise<Response> {
  return handleFakeCheckoutAction(request, routeContext, { cancel: fakeCheckout.cancel });
}
