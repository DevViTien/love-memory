import { describe, expect, it } from "vitest";

import {
  checkArchiveGate,
  checkModifiedBodyGate,
  countTasks,
  identifiers,
  validateWaiverShape,
} from "../scripts/openspec-gates";

const today = "2026-10-01";

const currentSpec = `# Gift drafts

## Purpose

Drafts.

## Requirements

### Requirement: Optimistic concurrency

The system SHALL reject stale writes with \`409\` and \`REVISION_CONFLICT\`.

#### Scenario: Stale revision

- **WHEN** a client sends \`expectedRevision\` older than the stored one
- **THEN** the API returns \`REVISION_CONFLICT\`
`;

function modifiedDelta(body: string) {
  return `## MODIFIED Requirements

### Requirement: Optimistic concurrency

${body}

#### Scenario: Stale revision

- **WHEN** a stale write arrives
- **THEN** it is rejected
`;
}

describe("countTasks", () => {
  it("counts checked and unchecked checklist items", () => {
    expect(countTasks("- [x] 1.1 Done\n- [X] 1.2 Done\n  - [ ] 1.3 Open\n* [ ] 1.4 Open")).toEqual({
      done: 2,
      total: 4,
    });
  });
});

describe("checkArchiveGate", () => {
  it("fails for a completed change that is not archived", () => {
    const result = checkArchiveGate(
      [{ name: "add-preview", tasksMarkdown: "- [x] 1.1 Build\n- [x] 1.2 Archive" }],
      [],
      today,
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("add-preview");
  });

  it("passes for in-progress changes and changes without tasks", () => {
    const result = checkArchiveGate(
      [
        { name: "add-preview", tasksMarkdown: "- [x] 1.1 Build\n- [ ] 1.2 Test" },
        { name: "explore-idea", tasksMarkdown: null },
      ],
      [],
      today,
    );

    expect(result.errors).toEqual([]);
  });

  it("honors a live waiver and rejects expired or stale ones", () => {
    const completed = [{ name: "add-preview", tasksMarkdown: "- [x] 1.1 Build" }];
    const waiver = {
      change: "add-preview",
      expires: "2026-12-31",
      owner: "dev",
      reason: "blocked",
    };

    expect(checkArchiveGate(completed, [waiver], today).errors).toEqual([]);
    expect(
      checkArchiveGate(completed, [{ ...waiver, expires: "2026-09-30" }], today).errors[0],
    ).toContain("expired");
    expect(checkArchiveGate([], [waiver], today).errors[0]).toContain("no longer matches");
  });
});

describe("checkModifiedBodyGate", () => {
  const specs = new Map([["gift-drafts", currentSpec]]);

  it("passes when a MODIFIED requirement keeps every identifier", () => {
    const markdown = modifiedDelta(
      "The system SHALL reject stale writes with `409`, `REVISION_CONFLICT` and `expectedRevision`.",
    );

    const result = checkModifiedBodyGate(
      [{ capability: "gift-drafts", change: "tighten-drafts", markdown }],
      specs,
      [],
      today,
    );

    expect(result.errors).toEqual([]);
  });

  it("fails when a MODIFIED requirement drops an identifier", () => {
    const markdown = modifiedDelta("The system SHALL reject stale writes with `409`.");

    const result = checkModifiedBodyGate(
      [{ capability: "gift-drafts", change: "tighten-drafts", markdown }],
      specs,
      [],
      today,
    );

    expect(result.errors[0]).toContain("`REVISION_CONFLICT`");
    expect(result.errors[0]).toContain("`expectedRevision`");
  });

  it("matches a renamed requirement against its previous name", () => {
    const markdown = `## RENAMED Requirements

- FROM: \`### Requirement: Optimistic concurrency\`
- TO: \`### Requirement: Revision conflicts\`

## MODIFIED Requirements

### Requirement: Revision conflicts

The system SHALL reject stale writes with \`409\`.

#### Scenario: Stale revision

- **WHEN** a stale write arrives
- **THEN** it is rejected
`;

    const result = checkModifiedBodyGate(
      [{ capability: "gift-drafts", change: "rename", markdown }],
      specs,
      [],
      today,
    );

    expect(result.errors[0]).toContain("`REVISION_CONFLICT`");
  });

  it("warns instead of failing when the MODIFIED target does not exist yet", () => {
    const markdown = modifiedDelta("The system SHALL do something.").replace(
      "Optimistic concurrency",
      "Unknown requirement",
    );

    const result = checkModifiedBodyGate(
      [{ capability: "gift-drafts", change: "child", markdown }],
      specs,
      [],
      today,
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("rejects unknown delta section headers", () => {
    const result = checkModifiedBodyGate(
      [{ capability: "gift-drafts", change: "typo", markdown: "## Modified Requirements\n" }],
      specs,
      [],
      today,
    );

    expect(result.errors[0]).toContain("unknown section");
  });

  it("accepts a live waiver for an intentional removal and rejects an unused one", () => {
    const markdown = modifiedDelta("The system SHALL reject stale writes with `409`.");
    const waiver = {
      capability: "gift-drafts",
      change: "tighten-drafts",
      expires: "2026-12-31",
      owner: "dev",
      reason: "Error code renamed.",
      requirement: "Optimistic concurrency",
    };
    const delta = { capability: "gift-drafts", change: "tighten-drafts", markdown };

    expect(checkModifiedBodyGate([delta], specs, [waiver], today).errors).toEqual([]);
    expect(checkModifiedBodyGate([], specs, [waiver], today).errors[0]).toContain(
      "no longer matches",
    );
  });
});

describe("waiver and identifier helpers", () => {
  it("requires owner, reason and a well-formed expiry", () => {
    expect(validateWaiverShape({ change: "x", expires: "2026-1-5" }, "w", ["change"])).toEqual([
      'w: missing "owner".',
      'w: missing "reason".',
      'w: "expires" must be YYYY-MM-DD, got "2026-1-5".',
    ]);
  });

  it("extracts backticked identifiers", () => {
    expect([...identifiers("Use `GIFT_NOT_FOUND` and `/api/gifts`, not `x`.")]).toEqual([
      "GIFT_NOT_FOUND",
      "/api/gifts",
    ]);
  });
});
