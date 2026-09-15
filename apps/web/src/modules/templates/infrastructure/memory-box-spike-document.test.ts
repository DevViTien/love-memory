import { describe, expect, it } from "vitest";

import { MEMORY_BOX_SPIKE_DOCUMENT } from "@love-memory/template-memory-box-spike";

describe("memory box spike artifact", () => {
  it("contains the lifecycle protocol without network primitives", () => {
    expect(MEMORY_BOX_SPIKE_DOCUMENT).toContain('data.type === "INIT"');
    expect(MEMORY_BOX_SPIKE_DOCUMENT).toContain('data.type === "DESTROY"');
    expect(MEMORY_BOX_SPIKE_DOCUMENT).toContain('type: "COMPLETE"');
    expect(MEMORY_BOX_SPIKE_DOCUMENT).not.toMatch(/fetch\s*\(|XMLHttpRequest|WebSocket/);
  });
});
