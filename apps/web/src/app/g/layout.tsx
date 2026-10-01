import { connection } from "next/server";
import { type ReactNode } from "react";

export default async function PublicGiftLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Share links use a per-request nonce CSP and must never be prerendered or cached publicly.
  await connection();

  return children;
}
