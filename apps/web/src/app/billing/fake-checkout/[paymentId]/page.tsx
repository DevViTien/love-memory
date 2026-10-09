import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getBillingEnvironment } from "@/config/billing";
import { fakeCheckout } from "@/composition/billing";
import { FakeCheckoutActions } from "@/modules/billing/presentation/fake-checkout-actions";
import { formatPlanPrice } from "@/modules/gifts/presentation/studio/plan-format";

/**
 * The fake provider's checkout page (`billing-checkout` "Fake billing provider"). Not found unless
 * the fake provider is the configured one, so no deployed tier serves it.
 */
export default async function FakeCheckoutPage({
  params,
}: Readonly<{ params: Promise<{ paymentId: string }> }>) {
  await connection();
  if (getBillingEnvironment().kind !== "fake") notFound();
  const link = fakeCheckout.find((await params).paymentId);
  if (!link) notFound();

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-12">
      <p className="text-xs font-bold tracking-wide text-amber-700 uppercase">
        Cổng thanh toán thử — không thu tiền thật
      </p>
      <h1 className="text-2xl font-black text-stone-900">{formatPlanPrice(link.amountVnd)}</h1>
      <p className="text-stone-700">Nội dung chuyển khoản: {link.description}</p>
      {link.status === "PENDING" ? (
        <FakeCheckoutActions cancelUrl={link.cancelUrl} paymentId={link.paymentId} />
      ) : (
        <p className="font-semibold text-stone-700">Phiên thanh toán này đã kết thúc.</p>
      )}
    </main>
  );
}
