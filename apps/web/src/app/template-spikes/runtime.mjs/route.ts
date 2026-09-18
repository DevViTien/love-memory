import { MEMORY_BOX_SPIKE_RUNTIME } from "@love-memory/template-memory-box-spike";

import { getTechnicalSpikeEnvironment } from "@/config/technical-spikes";

export const dynamic = "force-dynamic";

export function GET(): Response {
  if (!getTechnicalSpikeEnvironment().enabled) {
    return new Response(null, { headers: { "Cache-Control": "private, no-store" }, status: 404 });
  }
  return new Response(MEMORY_BOX_SPIKE_RUNTIME, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "private, no-store",
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
