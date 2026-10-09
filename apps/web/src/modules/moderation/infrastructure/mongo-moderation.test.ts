import type * as DatabaseModule from "@love-memory/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getMongoClient: vi.fn() }));

vi.mock("@love-memory/database", async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseModule>()),
  getDatabase: databaseMocks.getDatabase,
  getMongoClient: databaseMocks.getMongoClient,
}));

import { type AbuseReport } from "../application/abuse-reports";
import { mongoAbuseReportStore, mongoModerationRepository } from "./mongo-moderation";

const now = new Date("2026-10-10T10:00:00.000Z");
const report: AbuseReport = {
  category: "child_safety",
  createdAt: now,
  details: null,
  expiresAt: new Date("2027-10-10T10:00:00.000Z"),
  giftId: "gift-1",
  id: "report-1",
  severity: "critical",
  severityRank: 0,
  status: "open",
  updatedAt: now,
};

type Mock = ReturnType<typeof vi.fn>;

describe("Mongo moderation", () => {
  let collections: Record<string, Record<string, Mock>>;
  const session = {
    withTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const collection = () => ({
      aggregate: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      insertOne: vi.fn(),
      updateMany: vi.fn(),
      updateOne: vi.fn(() => Promise.resolve({ modifiedCount: 1 })),
    });
    collections = {
      abuseReports: collection(),
      auditLog: collection(),
      giftTombstones: collection(),
      gifts: collection(),
      jobOutbox: collection(),
    };
    databaseMocks.getDatabase.mockResolvedValue({
      collection: (name: string) => collections[name],
    });
    databaseMocks.getMongoClient.mockResolvedValue({
      withSession: (work: (value: typeof session) => Promise<void>) => work(session),
    });
  });

  describe("report insert", () => {
    it("stores the report and takes the gift down for an emergency, in one transaction", async () => {
      await mongoAbuseReportStore.insertReport({ emergency: true, report });

      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      const { id: _id, ...fields } = report;
      expect(collections["abuseReports"]!["insertOne"]).toHaveBeenCalledWith(
        { _id: "report-1", ...fields },
        { session },
      );
      expect(collections["gifts"]!["updateOne"]).toHaveBeenCalledWith(
        { _id: "gift-1", status: { $in: ["published", "paused"] }, takedown: { $exists: false } },
        [
          {
            $set: {
              pausedAt: { $ifNull: ["$pausedAt", now] },
              status: "paused",
              takedown: { at: now, by: "system", reason: "child_safety" },
              updatedAt: now,
            },
          },
        ],
        { session },
      );
      expect(collections["auditLog"]!["insertOne"]).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "gift.taken_down",
          actor: { id: "abuse-report", kind: "system" },
          metadata: { reason: "child_safety" },
          target: { id: "gift-1", kind: "gift" },
        }),
        { session },
      );
      // The owner's email, without any report detail (`system-emails`).
      expect(collections["jobOutbox"]!["updateOne"]).toHaveBeenCalledWith(
        { deduplicationKey: `email.send.v1:gift_taken_down:gift-1:${now.toISOString()}` },
        {
          $setOnInsert: expect.objectContaining({
            payload: { eventKey: now.toISOString(), giftId: "gift-1", kind: "gift_taken_down" },
            type: "email.send.v1",
          }) as object,
        },
        { session, upsert: true },
      );
    });

    it("records no takedown when the gift already holds one, or for a normal report", async () => {
      collections["gifts"]!["updateOne"]!.mockResolvedValueOnce({ modifiedCount: 0 });
      await mongoAbuseReportStore.insertReport({ emergency: true, report });
      expect(collections["auditLog"]!["insertOne"]).not.toHaveBeenCalled();
      expect(collections["jobOutbox"]!["updateOne"]).not.toHaveBeenCalled();

      await mongoAbuseReportStore.insertReport({
        emergency: false,
        report: { ...report, category: "spam", severity: "normal", severityRank: 2 },
      });
      expect(collections["gifts"]!["updateOne"]).toHaveBeenCalledTimes(1);
    });
  });

  describe("admin actions", () => {
    const input = { actorId: "admin-1", now, report, requestId: "r-1" };

    it("takes a gift down, closes its open reports as actioned and audits", async () => {
      collections["gifts"]!["findOne"]!.mockResolvedValueOnce({
        _id: "gift-1",
        publicId: "pub-1",
        status: "published",
      });

      await expect(mongoModerationRepository.takeDown(input)).resolves.toBe("done");

      expect(collections["gifts"]!["updateOne"]).toHaveBeenCalledWith(
        expect.objectContaining({ _id: "gift-1" }),
        [
          expect.objectContaining({
            $set: expect.objectContaining({ status: "paused" }) as unknown,
          }),
        ],
        { session },
      );
      expect(collections["abuseReports"]!["updateMany"]).toHaveBeenCalledWith(
        { giftId: "gift-1", status: "open" },
        { $set: { resolvedAt: now, status: "actioned", updatedAt: now } },
        { session },
      );
      expect(collections["auditLog"]!["insertOne"]).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "admin.gift.taken_down",
          metadata: { reason: "child_safety", reportId: "report-1" },
        }),
        { session },
      );
      expect(collections["jobOutbox"]!["updateOne"]).toHaveBeenCalledWith(
        { deduplicationKey: `email.send.v1:gift_taken_down:gift-1:${now.toISOString()}` },
        expect.anything(),
        { session, upsert: true },
      );
    });

    it("reports a gone gift without writing", async () => {
      collections["gifts"]!["findOne"]!.mockResolvedValueOnce(null);

      await expect(mongoModerationRepository.takeDown(input)).resolves.toBe("gift-gone");
      collections["gifts"]!["findOne"]!.mockResolvedValueOnce(null);
      await expect(mongoModerationRepository.restore(input)).resolves.toBe("gift-gone");
      expect(collections["auditLog"]!["insertOne"]).not.toHaveBeenCalled();
    });

    it("restores only a taken-down gift, published again only while it lasts", async () => {
      collections["gifts"]!["findOne"]!.mockResolvedValueOnce({
        _id: "gift-1",
        publicId: "pub-1",
        status: "paused",
      });
      await expect(mongoModerationRepository.restore(input)).resolves.toBe("not-taken-down");
      expect(collections["gifts"]!["updateOne"]).not.toHaveBeenCalled();

      collections["gifts"]!["findOne"]!.mockResolvedValueOnce({
        _id: "gift-1",
        publicId: "pub-1",
        status: "paused",
        takedown: { at: now, by: "system", reason: "child_safety" },
      });
      await expect(mongoModerationRepository.restore(input)).resolves.toBe("done");

      const live = { $gt: ["$expiresAt", now] };
      expect(collections["gifts"]!["updateOne"]).toHaveBeenCalledWith(
        { _id: "gift-1", status: "paused", takedown: { $exists: true } },
        [
          {
            $set: {
              pausedAt: { $cond: [live, "$$REMOVE", "$pausedAt"] },
              status: { $cond: [live, "published", "paused"] },
              takedown: "$$REMOVE",
              updatedAt: now,
            },
          },
        ],
        { session },
      );
      expect(collections["abuseReports"]!["updateMany"]).toHaveBeenCalledWith(
        { giftId: "gift-1", status: "open" },
        { $set: { resolvedAt: now, status: "dismissed", updatedAt: now } },
        { session },
      );
      expect(collections["auditLog"]!["insertOne"]).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "admin.gift.restored",
          metadata: { reportId: "report-1" },
        }),
        { session },
      );
    });

    it("dismisses one report and audits it with the report as target", async () => {
      await mongoModerationRepository.dismiss(input);

      expect(collections["abuseReports"]!["updateOne"]).toHaveBeenCalledWith(
        { _id: "report-1", status: "open" },
        { $set: { resolvedAt: now, status: "dismissed", updatedAt: now } },
        { session },
      );
      expect(collections["auditLog"]!["insertOne"]).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "admin.report.dismissed",
          target: { id: "report-1", kind: "report" },
        }),
        { session },
      );
    });
  });

  describe("queue reads", () => {
    it("lists open reports by severity then newest first", async () => {
      const limit = vi.fn(() => ({
        toArray: () => Promise.resolve([{ ...report, _id: "report-1" }]),
      }));
      const sort = vi.fn(() => ({ limit }));
      collections["abuseReports"]!["find"]!.mockReturnValueOnce({ sort });

      await expect(mongoModerationRepository.listOpen(100)).resolves.toEqual([report]);
      expect(collections["abuseReports"]!["find"]).toHaveBeenCalledWith({ status: "open" });
      expect(sort).toHaveBeenCalledWith({ severityRank: 1, createdAt: -1 });
      expect(limit).toHaveBeenCalledWith(100);
    });

    it("reads one report", async () => {
      collections["abuseReports"]!["findOne"]!.mockResolvedValueOnce({
        ...report,
        _id: "report-1",
      }).mockResolvedValueOnce(null);

      await expect(mongoModerationRepository.findReport("report-1")).resolves.toEqual(report);
      await expect(mongoModerationRepository.findReport("x")).resolves.toBeNull();
    });

    it("maps gifts, deleting gifts and tombstones to their states", async () => {
      collections["gifts"]!["find"]!.mockReturnValueOnce({
        toArray: () =>
          Promise.resolve([
            { _id: "g-live", publicId: "p-1", status: "paused", takedown: { at: now } },
            { _id: "g-deleting", publicId: "p-2", status: "deleting" },
          ]),
      });
      collections["giftTombstones"]!["find"]!.mockReturnValueOnce({
        toArray: () => Promise.resolve([{ _id: "g-gone", publicId: "p-3" }]),
      });

      const states = await mongoModerationRepository.findGiftStates([
        "g-live",
        "g-deleting",
        "g-gone",
      ]);

      expect(states.get("g-live")).toEqual({
        gone: false,
        id: "g-live",
        publicId: "p-1",
        status: "paused",
        takenDown: true,
      });
      expect(states.get("g-deleting")).toEqual({ gone: true, id: "g-deleting", publicId: "p-2" });
      expect(states.get("g-gone")).toEqual({ gone: true, id: "g-gone", publicId: "p-3" });
      await expect(mongoModerationRepository.findGiftStates([])).resolves.toEqual(new Map());
    });

    it("counts open reports per gift", async () => {
      collections["abuseReports"]!["aggregate"]!.mockReturnValueOnce({
        toArray: () => Promise.resolve([{ _id: "gift-1", count: 3 }]),
      });

      await expect(mongoModerationRepository.countOpenByGift(["gift-1"])).resolves.toEqual(
        new Map([["gift-1", 3]]),
      );
      expect(collections["abuseReports"]!["aggregate"]).toHaveBeenCalledWith([
        { $match: { giftId: { $in: ["gift-1"] }, status: "open" } },
        { $group: { _id: "$giftId", count: { $sum: 1 } } },
      ]);
      await expect(mongoModerationRepository.countOpenByGift([])).resolves.toEqual(new Map());
    });
  });
});
