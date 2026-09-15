import { z } from "zod";

const MongoEnvironmentSchema = z.object({
  MONGODB_DATABASE: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[^/\\."$*<>:|?\u0000]+$/, { message: "Invalid MongoDB database name." })
    .default("love_memory"),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//, {
    message: "Expected a MongoDB connection URI.",
  }),
});

export type MongoEnvironment = Readonly<{
  databaseName: string;
  uri: string;
}>;

export function parseMongoEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): MongoEnvironment {
  const environment = MongoEnvironmentSchema.parse(source);

  return {
    databaseName: environment.MONGODB_DATABASE,
    uri: environment.MONGODB_URI,
  };
}
