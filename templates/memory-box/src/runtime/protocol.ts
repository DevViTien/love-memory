import type { TemplateEvent } from "@love-memory/template-sdk";

/**
 * Hand-written guards that mirror the SDK's strict host message schema (`TemplateHostMessageSchema`)
 * so the runtime does not bundle Zod. `protocol.test.ts` checks that both agree on the same samples.
 */

export type InitMessage = Readonly<{
  assets: Readonly<Record<string, string>>;
  context: Readonly<{ locale: string; prefersReducedMotion: boolean }>;
  payload: Readonly<Record<string, unknown>>;
  protocolVersion: 1;
  type: "INIT";
}>;

export type HostMessage =
  | InitMessage
  | Readonly<{ type: "DESTROY" }>
  | Readonly<{ type: "PAUSE" }>
  | Readonly<{ type: "PLAY" }>;

export type ReadHostMessageResult =
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "invalid-init" }>
  | Readonly<{ kind: "message"; message: HostMessage }>;

type UnknownRecord = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!isObject(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isPlainRecord(value) && Object.values(value).every(isJsonValue);
}

function isUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

function isAssets(value: unknown): value is Readonly<Record<string, string>> {
  return (
    isPlainRecord(value) &&
    Object.entries(value).every(([key, url]) => key.length >= 1 && key.length <= 160 && isUrl(url))
  );
}

function isContext(value: unknown): value is InitMessage["context"] {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["locale", "prefersReducedMotion"]) &&
    typeof value["locale"] === "string" &&
    value["locale"].length >= 2 &&
    value["locale"].length <= 35 &&
    typeof value["prefersReducedMotion"] === "boolean"
  );
}

function isInit(value: UnknownRecord): boolean {
  return (
    hasOnlyKeys(value, ["context", "payload", "protocolVersion", "type"], ["assets"]) &&
    value["protocolVersion"] === 1 &&
    isContext(value["context"]) &&
    isPlainRecord(value["payload"]) &&
    Object.values(value["payload"]).every(isJsonValue) &&
    (value["assets"] === undefined || isAssets(value["assets"]))
  );
}

/** Classifies one message from the host. A malformed `INIT` is reported so it can be answered. */
export function readHostMessage(data: unknown): ReadHostMessageResult {
  if (!isObject(data)) return { kind: "ignored" };

  switch (data["type"]) {
    case "INIT":
      if (!isInit(data)) return { kind: "invalid-init" };
      return {
        kind: "message",
        message: {
          assets: (data["assets"] as InitMessage["assets"] | undefined) ?? {},
          context: data["context"] as InitMessage["context"],
          payload: data["payload"] as InitMessage["payload"],
          protocolVersion: 1,
          type: "INIT",
        },
      };
    case "PLAY":
    case "PAUSE":
    case "DESTROY":
      return hasOnlyKeys(data, ["type"])
        ? { kind: "message", message: { type: data["type"] } }
        : { kind: "ignored" };
    default:
      return { kind: "ignored" };
  }
}

/** Whether the data is a valid host message (same answer as the SDK schema). */
export function isHostMessage(data: unknown): boolean {
  return readHostMessage(data).kind === "message";
}

/** Serializes JSON-like values with recursively sorted keys, for deep-equality checks. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type MessageTarget = Readonly<{
  postMessage: (message: TemplateEvent, targetOrigin: string) => void;
}>;

/**
 * Posts template events to the host. The artifact runs with an opaque origin, so `"*"` is the only
 * possible target origin; the host checks the exact iframe `source` instead.
 */
export function createPoster(target: MessageTarget): (event: TemplateEvent) => void {
  return (event) => target.postMessage(event, "*");
}

/**
 * Listens for host messages and ignores every message whose source is not the parent window, which
 * is the Viewer host. Returns the function that stops listening.
 */
export function listenToParent(
  target: Pick<Window, "addEventListener" | "parent" | "removeEventListener">,
  onData: (data: unknown) => void,
): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.source !== target.parent) return;
    onData(event.data);
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}
