import { OrderStatusSchema, PlanIdSchema } from "@love-memory/domain";
import { z } from "zod";

import { createApiSuccessSchema } from "./api";
import { PublishGiftRequestSchema } from "./gift";

export { OrderStatusSchema };

/** `POST /api/gifts/{publicId}/checkout`: the same body as a first publish. */
export const StartCheckoutRequestSchema = PublishGiftRequestSchema;

export const OrderIdSchema = z.uuid();

/**
 * An order as its owner sees it (`billing-checkout` "Order status endpoint"). `checkoutUrl` is set
 * only while the order is `pending`.
 */
export const OrderDtoSchema = z
  .object({
    amountVnd: z.number().int().nonnegative(),
    checkoutUrl: z.url().nullable(),
    createdAt: z.iso.datetime(),
    currency: z.literal("VND"),
    expiresAt: z.iso.datetime(),
    giftPublicId: z.string().min(1),
    orderId: OrderIdSchema,
    planId: PlanIdSchema,
    status: OrderStatusSchema,
  })
  .strict();

export const OrderResponseSchema = createApiSuccessSchema(z.object({ order: OrderDtoSchema }));

export type StartCheckoutRequest = z.infer<typeof StartCheckoutRequestSchema>;
export type OrderDto = z.infer<typeof OrderDtoSchema>;
export type OrderResponse = z.infer<typeof OrderResponseSchema>;
