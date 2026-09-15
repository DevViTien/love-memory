import "server-only";

import { randomUUID } from "node:crypto";

import { type Collection, type MongoClient } from "mongodb";

import { getDatabase, getMongoClient } from "./client";
import { COLLECTIONS } from "./collections";

type ProbeDocument = Readonly<{
  _id: string;
  createdAt: Date;
  kind: "read-write-probe";
}>;

type ProbeCollection = Pick<Collection<ProbeDocument>, "deleteOne" | "findOne" | "insertOne">;

export type MongoSpikeDependencies = Readonly<{
  createId?: () => string;
  getClient: () => Promise<MongoClient>;
  getProbeCollection: () => Promise<ProbeCollection>;
  now?: () => Date;
}>;

export function createMongoReadWriteProbe({
  createId = randomUUID,
  getClient,
  getProbeCollection,
  now = () => new Date(),
}: MongoSpikeDependencies) {
  return async function runMongoReadWriteProbe() {
    const [firstClient, secondClient] = await Promise.all([getClient(), getClient()]);
    const collection = await getProbeCollection();
    const id = createId();
    const document: ProbeDocument = {
      _id: id,
      createdAt: now(),
      kind: "read-write-probe",
    };

    try {
      const insertResult = await collection.insertOne(document);
      const readDocument = await collection.findOne({ _id: id });

      return {
        connectionReused: firstClient === secondClient,
        readVerified: readDocument?._id === id,
        writeVerified: insertResult.acknowledged && insertResult.insertedId === id,
      } as const;
    } finally {
      await collection.deleteOne({ _id: id });
    }
  };
}

const runMongoReadWriteProbe = createMongoReadWriteProbe({
  getClient: getMongoClient,
  getProbeCollection: async () => {
    const database = await getDatabase();
    return database.collection<ProbeDocument>(COLLECTIONS.technicalSpikes);
  },
});

export { runMongoReadWriteProbe };
