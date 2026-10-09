import { UUID } from "mongodb";

/**
 * Better Auth's Mongo adapter (`generateId: "uuid"`) stores user ids, and every field that
 * references one (`sessions.userId`, `twoFactors.userId`), as BSON UUIDs, and hands them to the
 * application as strings. A query from the application side matches either form.
 */
export function authIdFilter(id: string): Readonly<{ $in: readonly (string | UUID)[] }> {
  return { $in: UUID.isValid(id) ? [new UUID(id), id] : [id] };
}

/** The string form the adapter gives the application (`UUID.toString()`), for any stored id. */
export function authIdString(value: unknown): string {
  if (value instanceof UUID) return value.toString();
  if (typeof value === "string") return value;
  throw new Error("Unexpected Better Auth id type.");
}
