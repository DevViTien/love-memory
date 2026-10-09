import { headers } from "next/headers";

import { checkoutService } from "@/composition/billing";
import { CheckoutPage } from "@/modules/billing/presentation/checkout-page";
import { getGiftRequestContextFromHeaders } from "@/modules/gifts/presentation/gift-route-helpers";

export const dynamic = "force-dynamic";

export default async function CheckoutCancelPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const [context, query] = await Promise.all([
    getGiftRequestContextFromHeaders(await headers()),
    searchParams,
  ]);
  return (
    <CheckoutPage
      getOrder={(input) => checkoutService.getOrder(input)}
      kind="cancel"
      orderParam={query["order"]}
      userId={context.userId}
    />
  );
}
