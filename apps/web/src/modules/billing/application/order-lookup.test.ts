import { type Order } from "@love-memory/domain";
import { describe, expect, it, vi } from "vitest";

import { type AdminSession } from "@/modules/admin/application/admin-access";

import { type AdminOrderLookupRepository, createOrderLookupService } from "./order-lookup";

const session = { user: { id: "admin-1" } } as unknown as AdminSession;
const now = new Date("2026-10-10T10:00:00.000Z");
const order = {
  amountVnd: 49_000,
  createdAt: now,
  id: "0b3c5a7e-1f1c-4b8e-9a51-6c0f2d7e8a90",
} as Order;

describe("admin order lookup", () => {
  function service(orders: readonly Order[]) {
    const record = vi.fn(() => Promise.resolve({} as never));
    const repository = {
      findAttempts: vi.fn<AdminOrderLookupRepository["findAttempts"]>(() => Promise.resolve([])),
      findOrders: vi.fn<AdminOrderLookupRepository["findOrders"]>(() => Promise.resolve(orders)),
    };
    return {
      lookup: createOrderLookupService({ audit: { record }, repository }),
      record,
      repository,
    };
  }

  it("audits a search before answering, without the searched text (Admin order lookup)", async () => {
    const { lookup, record, repository } = service([order]);

    await expect(
      lookup.lookup({ query: " 123456789012 ", requestId: "r-1", session }),
    ).resolves.toEqual({ attempts: [], kind: "found", orders: [order] });
    expect(repository.findOrders).toHaveBeenCalledWith({ text: "123456789012" }, 20);
    expect(repository.findAttempts).toHaveBeenCalledWith([order.id]);
    expect(record).toHaveBeenCalledWith(
      {
        action: "admin.order.looked_up",
        actor: { id: "admin-1", kind: "admin" },
        metadata: { matched: 1 },
        target: { id: order.id, kind: "order" },
      },
      "r-1",
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain("123456789012");
  });

  it("answers empty, not-found and over-long queries", async () => {
    const empty = service([]);
    await expect(empty.lookup.lookup({ query: "  ", requestId: null, session })).resolves.toEqual({
      kind: "empty",
    });
    expect(empty.record).not.toHaveBeenCalled();

    await expect(
      empty.lookup.lookup({ query: "x".repeat(65), requestId: null, session }),
    ).resolves.toEqual({ kind: "not-found" });
    expect(empty.repository.findOrders).not.toHaveBeenCalled();
    expect(empty.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { matched: 0 }, target: null }),
      null,
    );
  });
});
