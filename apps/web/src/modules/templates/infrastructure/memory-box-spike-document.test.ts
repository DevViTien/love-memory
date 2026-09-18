import { describe, expect, it } from "vitest";

import {
  MEMORY_BOX_SPIKE_DOCUMENT,
  MEMORY_BOX_SPIKE_RUNTIME,
} from "@love-memory/template-memory-box-spike";

describe("memory box spike artifact", () => {
  it("contains the lifecycle protocol without network primitives", () => {
    expect(MEMORY_BOX_SPIKE_DOCUMENT).toContain('type="module" src="runtime.mjs"');
    expect(MEMORY_BOX_SPIKE_RUNTIME).toContain('data.type === "INIT"');
    expect(MEMORY_BOX_SPIKE_RUNTIME).toContain('data.type === "DESTROY"');
    expect(MEMORY_BOX_SPIKE_RUNTIME).toContain('type: "COMPLETE"');
    expect(MEMORY_BOX_SPIKE_RUNTIME).not.toMatch(/fetch\s*\(|XMLHttpRequest|WebSocket/);
  });
});
