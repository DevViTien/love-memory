import { MEMORY_BOX_SPIKE_DOCUMENT } from "@love-memory/template-memory-box-spike";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(MEMORY_BOX_SPIKE_DOCUMENT, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
