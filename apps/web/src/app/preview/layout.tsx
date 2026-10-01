import { connection } from "next/server";
import { type ReactNode } from "react";

export default async function PreviewLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Preview pages carry private draft content under a per-request nonce CSP, so this route tree
  // must never be prerendered.
  await connection();

  return children;
}
