import { type Order } from "@love-memory/domain";

import { type AdminSession } from "@/modules/admin/application/admin-access";
import { type AuditService } from "@/modules/admin/application/audit";

/** No order identifier is longer; anything longer matches nothing and is not queried. */
export const ORDER_LOOKUP_MAX_LENGTH = 64;
export const ORDER_LOOKUP_LIMIT = 20;

/** A recorded provider payment as support sees it: never its reference or raw payload. */
export type AdminPaymentAttempt = Readonly<{
  amountVnd: number;
  currency: string;
  orderId: string | null;
  outcome: string;
  provider: string;
  receivedAt: Date;
  source: string;
}>;

export interface AdminOrderLookupRepository {
  /** Exact matches on the order id, the order code, or the gift's public id; newest first. */
  findOrders(query: Readonly<{ text: string }>, limit: number): Promise<readonly Order[]>;
  findAttempts(orderIds: readonly string[]): Promise<readonly AdminPaymentAttempt[]>;
}

export type OrderLookupResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      attempts: readonly AdminPaymentAttempt[];
      kind: "found";
      orders: readonly Order[];
    }>
  | Readonly<{ kind: "not-found" }>;

/**
 * `billing-checkout` "Admin order lookup": the support view of orders and fulfillment. Audited
 * before anything is returned; the searched text is never recorded.
 */
export function createOrderLookupService({
  audit,
  repository,
}: Readonly<{ audit: Pick<AuditService, "record">; repository: AdminOrderLookupRepository }>) {
  return {
    async lookup(
      input: Readonly<{ query: string; requestId: string | null; session: AdminSession }>,
    ): Promise<OrderLookupResult> {
      const text = input.query.trim();
      if (!text) return { kind: "empty" };
      const orders =
        text.length <= ORDER_LOOKUP_MAX_LENGTH
          ? await repository.findOrders({ text }, ORDER_LOOKUP_LIMIT)
          : [];
      const first = orders[0];
      await audit.record(
        {
          action: "admin.order.looked_up",
          actor: { id: input.session.user.id, kind: "admin" },
          metadata: { matched: orders.length },
          target: first ? { id: first.id, kind: "order" } : null,
        },
        input.requestId,
      );
      if (orders.length === 0) return { kind: "not-found" };
      const attempts = await repository.findAttempts(orders.map((order) => order.id));
      return { attempts, kind: "found", orders };
    },
  } as const;
}
