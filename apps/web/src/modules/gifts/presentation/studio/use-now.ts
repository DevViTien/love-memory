"use client";

import { useState } from "react";

/**
 * The time the component first rendered, read once: render stays pure, and display-only time
 * checks (such as an expired gift) are settled when the page loads. The server decides again.
 */
export function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
