export const COLLECTIONS = {
  abuseReports: "abuseReports",
  assets: "assets",
  giftRevisions: "giftRevisions",
  gifts: "gifts",
  idempotencyKeys: "idempotencyKeys",
  jobOutbox: "jobOutbox",
  orders: "orders",
  paymentAttempts: "paymentAttempts",
  reactions: "reactions",
  templateVersions: "templateVersions",
  templates: "templates",
  technicalSpikes: "technicalSpikes",
  users: "users",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
