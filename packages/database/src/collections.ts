export const COLLECTIONS = {
  accounts: "accounts",
  abuseReports: "abuseReports",
  apiRateLimits: "apiRateLimits",
  assets: "assets",
  authRateLimits: "authRateLimits",
  databaseMigrations: "databaseMigrations",
  giftRevisions: "giftRevisions",
  gifts: "gifts",
  idempotencyKeys: "idempotencyKeys",
  jobOutbox: "jobOutbox",
  orders: "orders",
  paymentAttempts: "paymentAttempts",
  reactions: "reactions",
  sessions: "sessions",
  templateVersions: "templateVersions",
  templates: "templates",
  technicalSpikes: "technicalSpikes",
  users: "users",
  verifications: "verifications",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
