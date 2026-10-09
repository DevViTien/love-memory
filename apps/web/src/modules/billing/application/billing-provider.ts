import { type BillingProviderId } from "@love-memory/domain";

/** The statuses a provider reports for a payment link (payOS's set; the fake uses a subset). */
export type ProviderPaymentStatus =
  "CANCELLED" | "EXPIRED" | "FAILED" | "PAID" | "PENDING" | "PROCESSING" | "UNDERPAID";

export type CreatePaymentLinkInput = Readonly<{
  amountVnd: number;
  cancelUrl: string;
  description: string;
  expiresAt: Date;
  itemName: string;
  orderCode: number;
  returnUrl: string;
}>;

export type CreatedPaymentLink = Readonly<{ checkoutUrl: string; providerPaymentId: string }>;

export type ProviderPayment = Readonly<{
  amountPaidVnd: number;
  amountVnd: number;
  status: ProviderPaymentStatus;
}>;

/**
 * ADR-0009: the boundary around one payment provider. Every answer it returns has been verified
 * (signature, code); anything else is thrown as `BillingProviderError`.
 */
export interface BillingProvider {
  readonly id: BillingProviderId;
  cancelPaymentLink(orderCode: number, reason: string): Promise<void>;
  createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatedPaymentLink>;
  getPayment(orderCode: number): Promise<ProviderPayment>;
}

/** A refused, unreachable or unverifiable provider answer. The message never holds a secret. */
export class BillingProviderError extends Error {
  constructor(readonly reason: string) {
    super(`Billing provider failure: ${reason}`);
    this.name = "BillingProviderError";
  }
}
