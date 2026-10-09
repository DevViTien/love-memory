import { paymentService } from "@/composition/billing";
import { getBillingEnvironment } from "@/config/billing";
import { isValidDataSignature } from "@/modules/billing/infrastructure/payos-signature";
import { handlePayosWebhook } from "@/modules/billing/presentation/payos-webhook-route-handler";

export function POST(request: Request): Promise<Response> {
  return handlePayosWebhook(request, {
    checksumKey: () => {
      const environment = getBillingEnvironment();
      return environment.kind === "payos" ? environment.checksumKey : null;
    },
    record: (payment) => paymentService.recordVerifiedPayment(payment),
    verify: isValidDataSignature,
  });
}
