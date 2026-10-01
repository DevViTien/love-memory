import { TemplateHostMessageSchema } from "@love-memory/template-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  createPoster,
  isHostMessage,
  listenToParent,
  readHostMessage,
  stableStringify,
} from "./protocol";

const context = { locale: "vi-VN", prefersReducedMotion: false };
const init = {
  assets: { "550e8400-e29b-41d4-a716-446655441001": "https://assets.example.test/a.webp" },
  context,
  payload: { memories: [{ assetId: "a", caption: "Đà Lạt" }], "receiver-name": "An" },
  protocolVersion: 1,
  type: "INIT",
};

const samples: ReadonlyArray<readonly [string, unknown]> = [
  ["a complete INIT", init],
  ["an INIT without assets", { ...init, assets: undefined }],
  ["an INIT with a data: image URL", { ...init, assets: { a: "data:image/png;base64,AAAA" } }],
  ["an INIT with nested JSON values", { ...init, payload: { a: [1, null, true, { b: "c" }] } }],
  ["PLAY", { type: "PLAY" }],
  ["PAUSE", { type: "PAUSE" }],
  ["DESTROY", { type: "DESTROY" }],
  ["an INIT without context", { ...init, context: undefined }],
  ["an INIT with an extra context key", { ...init, context: { ...context, theme: "dark" } }],
  ["an INIT with a one-character locale", { ...init, context: { ...context, locale: "v" } }],
  [
    "an INIT with a 36-character locale",
    { ...init, context: { ...context, locale: "v".repeat(36) } },
  ],
  [
    "an INIT with a string reduced-motion flag",
    { ...init, context: { ...context, prefersReducedMotion: "no" } },
  ],
  ["an INIT with protocol version 2", { ...init, protocolVersion: 2 }],
  ["an INIT with an extra property", { ...init, extra: true }],
  ["an INIT with an array payload", { ...init, payload: [] }],
  ["an INIT with a non-finite number", { ...init, payload: { a: Number.POSITIVE_INFINITY } }],
  ["an INIT with an undefined payload value", { ...init, payload: { a: undefined } }],
  ["an INIT with an invalid asset URL", { ...init, assets: { a: "not a url" } }],
  ["an INIT with an empty asset id", { ...init, assets: { "": "https://a.test/x" } }],
  [
    "an INIT with a 161-character asset id",
    { ...init, assets: { ["a".repeat(161)]: "https://a.test/x" } },
  ],
  ["an INIT with a non-string asset URL", { ...init, assets: { a: 1 } }],
  ["PLAY with extra data", { type: "PLAY", at: 1 }],
  ["an unknown type", { type: "SEEK" }],
  ["a template event", { protocolVersion: 1, type: "READY" }],
  ["an array", ["PLAY"]],
  ["a string", "PLAY"],
  ["null", null],
];

describe("host message guards", () => {
  it.each(samples)("agrees with the SDK schema for %s", (_name, sample) => {
    expect(isHostMessage(sample)).toBe(TemplateHostMessageSchema.safeParse(sample).success);
  });

  it("classifies a malformed INIT so the template can answer it", () => {
    expect(readHostMessage({ ...init, context: undefined })).toEqual({ kind: "invalid-init" });
    expect(readHostMessage({ type: "PLAY", at: 1 })).toEqual({ kind: "ignored" });
    expect(readHostMessage({ ...init, assets: undefined })).toEqual({
      kind: "message",
      message: { ...init, assets: {} },
    });
  });
});

describe("stableStringify", () => {
  it("ignores key order and keeps array order", () => {
    expect(stableStringify({ b: [2, 1], a: { d: null, c: "x" } })).toBe(
      stableStringify({ a: { c: "x", d: null }, b: [2, 1] }),
    );
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify(undefined)).toBe("null");
  });
});

describe("parent window messaging", () => {
  it("accepts messages only from the parent window and stops listening", () => {
    const parent = {} as Window;
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const target = {
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.add(listener),
      parent,
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
        listeners.delete(listener),
    } as unknown as Window;
    const onData = vi.fn();
    const dispatch = (data: unknown, source: unknown) => {
      for (const listener of listeners) listener({ data, source } as MessageEvent<unknown>);
    };

    const stop = listenToParent(target, onData);
    dispatch({ type: "PLAY" }, {});
    dispatch({ type: "PLAY" }, parent);
    stop();
    dispatch({ type: "PAUSE" }, parent);

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith({ type: "PLAY" });
  });

  it("posts events to the parent with the only possible target origin", () => {
    const postMessage = vi.fn();
    createPoster({ postMessage })({ type: "COMPLETE" });

    expect(postMessage).toHaveBeenCalledWith({ type: "COMPLETE" }, "*");
  });
});
