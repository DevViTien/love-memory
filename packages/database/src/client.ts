import "server-only";

import { APP_CONFIG } from "@love-memory/shared";
import { type Db, MongoClient, type MongoClientOptions, ServerApiVersion } from "mongodb";

import { type MongoEnvironment, parseMongoEnvironment } from "./environment";
import { getOrCreateRecoverablePromise, type PromiseCache } from "./recoverable-promise-cache";

type MongoGlobal = typeof globalThis & {
  __loveMemoryMongoClientCache?: PromiseCache<MongoClient>;
};

const mongoGlobal = globalThis as MongoGlobal;
const productionClientCache: PromiseCache<MongoClient> = {};

export type MongoClientFactory = (uri: string, options: MongoClientOptions) => MongoClient;

const defaultMongoClientFactory: MongoClientFactory = (uri, options) =>
  new MongoClient(uri, options);

export type MongoGatewayDependencies = Readonly<{
  cache: PromiseCache<MongoClient>;
  clientFactory?: MongoClientFactory;
  environment: () => MongoEnvironment;
}>;

export async function connectMongoClient(
  environment: MongoEnvironment,
  factory: MongoClientFactory = defaultMongoClientFactory,
): Promise<MongoClient> {
  const client = factory(environment.uri, {
    appName: APP_CONFIG.slug,
    maxIdleTimeMS: 60000,
    maxPoolSize: 10,
    retryReads: true,
    retryWrites: true,
    serverApi: {
      deprecationErrors: true,
      strict: true,
      version: ServerApiVersion.v1,
    },
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 15000,
    waitQueueTimeoutMS: 5000,
  });

  try {
    return await client.connect();
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export function createMongoGateway({
  cache,
  clientFactory = defaultMongoClientFactory,
  environment: getEnvironment,
}: MongoGatewayDependencies) {
  function getMongoClient(): Promise<MongoClient> {
    const environment = getEnvironment();

    return getOrCreateRecoverablePromise(cache, () =>
      connectMongoClient(environment, clientFactory),
    );
  }

  async function getDatabase(): Promise<Db> {
    const environment = getEnvironment();
    const client = await getMongoClient();

    return client.db(environment.databaseName);
  }

  async function pingDatabase(): Promise<void> {
    const database = await getDatabase();
    await database.command({ ping: 1 });
  }

  return { getDatabase, getMongoClient, pingDatabase } as const;
}

function getRuntimeCache(): PromiseCache<MongoClient> {
  if (process.env["NODE_ENV"] === "production") {
    return productionClientCache;
  }

  mongoGlobal.__loveMemoryMongoClientCache ??= {};
  return mongoGlobal.__loveMemoryMongoClientCache;
}

const mongoGateway = createMongoGateway({
  cache: getRuntimeCache(),
  environment: () => parseMongoEnvironment(process.env),
});

export const { getDatabase, getMongoClient, pingDatabase } = mongoGateway;
