import { OrderIdSchema } from "@love-memory/contracts";
import { ROUTES } from "@love-memory/shared";
import { buttonVariants } from "@love-memory/ui";
import Link from "next/link";

import { type CheckoutService } from "../application/checkout-service";
import { CheckoutStatus } from "./checkout-status";

export const ORDER_NOT_FOUND = "Không tìm thấy đơn thanh toán này.";

/**
 * The body of `/checkout/return` and `/checkout/cancel`: the owner's order as the server reports it.
 * Only `order` is read from the query; the provider's own parameters are ignored.
 */
export async function CheckoutPage({
  getOrder,
  kind,
  orderParam,
  userId,
}: Readonly<{
  getOrder: CheckoutService["getOrder"];
  kind: "cancel" | "return";
  orderParam: string | string[] | undefined;
  userId: string | null;
}>) {
  const orderId = OrderIdSchema.safeParse(orderParam);
  if (!userId) {
    const next = `/checkout/${kind}${orderId.success ? `?order=${orderId.data}` : ""}`;
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black text-stone-900">Đăng nhập để xem thanh toán</h1>
        <Link
          className={buttonVariants({})}
          href={{ pathname: ROUTES.authSignIn, query: { next } }}
        >
          Đăng nhập
        </Link>
      </section>
    );
  }
  const result = orderId.success ? await getOrder({ orderId: orderId.data, userId }) : null;
  if (!result?.ok) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-black text-stone-900">{ORDER_NOT_FOUND}</h1>
        <Link className={buttonVariants({ variant: "outline" })} href={ROUTES.home}>
          Về trang chủ
        </Link>
      </section>
    );
  }
  return <CheckoutStatus initialOrder={result.data} />;
}
