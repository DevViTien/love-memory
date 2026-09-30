import { connection } from "next/server";
import { type ReactNode } from "react";

export default async function ViewerLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The Viewer uses a per-request nonce CSP, so its route tree must never be prerendered.
  await connection();

  return children;
}
