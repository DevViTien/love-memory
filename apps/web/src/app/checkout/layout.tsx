import { Container } from "@love-memory/ui";
import { connection } from "next/server";
import { type ReactNode } from "react";

/** The return and cancel pages (`billing-checkout`): per-request nonce CSP, never prerendered. */
export default async function CheckoutLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <main>
      <Container className="max-w-xl py-10 sm:py-14">{children}</Container>
    </main>
  );
}
