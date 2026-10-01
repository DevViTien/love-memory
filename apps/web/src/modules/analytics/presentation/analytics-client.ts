import {
  type AnalyticsContext,
  AnalyticsContextSchema,
  AnalyticsEventRequestSchema,
  type ClientAnalyticsEventName,
} from "@love-memory/contracts";

export const ANALYTICS_ENDPOINT = "/api/events";

const SESSION_KEY_PREFIX = "lm:analytics:session:";
const ONCE_KEY_PREFIX = "lm:analytics:once:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type PrivacySignals = Readonly<{ doNotTrack?: string | null; globalPrivacyControl?: boolean }>;

export type AnalyticsClient = Readonly<{
  /** Fire-and-forget: never awaited, never retried, never throws. */
  send: (name: ClientAnalyticsEventName, sceneId?: string) => void;
  /** `send`, at most once per event name and gift in this tab. */
  sendOnce: (name: ClientAnalyticsEventName) => void;
}>;

export type AnalyticsClientOptions = Readonly<{
  /** The page's analytics context; `null` or an invalid value gives a client that sends nothing. */
  context: AnalyticsContext | null | undefined;
  fetch?: typeof fetch;
  /** Per-page fallback when session storage is unavailable; shared by every client of the page. */
  memory?: AnalyticsMemory;
  navigator?: PrivacySignals | undefined;
  randomUUID?: () => string;
  /** Session storage, read lazily: merely reading `window.sessionStorage` can throw. */
  storage?: () => StorageLike | null | undefined;
}>;

export type AnalyticsMemory = Readonly<{
  once: Set<string>;
  sessions: Map<string, string>;
}>;

const pageMemory: AnalyticsMemory = { once: new Set(), sessions: new Map() };

const noopClient: AnalyticsClient = { send: () => undefined, sendOnce: () => undefined };

function defaultStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function defaultNavigator(): PrivacySignals | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

function readItem(storage: () => StorageLike | null | undefined, key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Whether the value was stored; `false` when storage is missing or throws. */
function writeItem(
  storage: () => StorageLike | null | undefined,
  key: string,
  value: string,
): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser side of `funnel-analytics` "Browser event transport". Each event is one same-origin
 * `fetch` with `keepalive` (it survives the navigation that follows `preview_started`), no
 * credentials, no cache and the request referrer policy `strict-origin`. Do not remove that
 * policy: it is what makes the request carry the page's real `Origin` on the
 * `Referrer-Policy: no-referrer` pages (`/g`, `/preview`), where the page policy would otherwise
 * turn `Origin` into `null` and fail the same-origin guard; it also keeps the Studio path out of
 * `Referer`. The default `cors` mode is a second safeguard: a `no-cors` request (and so
 * `navigator.sendBeacon`) gets `Origin: null` on such pages regardless. Nothing is sent without a valid context, or
 * when the browser signals Global Privacy Control or Do Not Track. The session id is scoped to one
 * gift in one tab, so a session never links two gifts.
 */
export function createAnalyticsClient(options: AnalyticsClientOptions): AnalyticsClient {
  const parsedContext = AnalyticsContextSchema.safeParse(options.context);
  if (!parsedContext.success) return noopClient;
  const context = parsedContext.data;

  const storage = options.storage ?? defaultStorage;
  const memory = options.memory ?? pageMemory;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const signals = "navigator" in options ? options.navigator : defaultNavigator();

  function optedOut(): boolean {
    return signals?.globalPrivacyControl === true || signals?.doNotTrack === "1";
  }

  function sessionId(): string {
    const key = `${SESSION_KEY_PREFIX}${context.giftRef}`;
    const stored = readItem(storage, key);
    if (stored && UUID_PATTERN.test(stored)) return stored;
    // Missing, malformed or unreadable: the page's in-memory id for this gift, or a new one.
    const id = memory.sessions.get(context.giftRef) ?? randomUUID();
    memory.sessions.set(context.giftRef, id);
    writeItem(storage, key, id);
    return id;
  }

  function send(name: ClientAnalyticsEventName, sceneId?: string): void {
    try {
      if (optedOut()) return;
      const event = AnalyticsEventRequestSchema.safeParse({
        giftRef: context.giftRef,
        name,
        ...(sceneId === undefined ? {} : { sceneId }),
        sessionId: sessionId(),
        templateId: context.templateId,
        templateVersion: context.templateVersion,
      });
      // A scene id that is not a kebab-case slug (or any other invalid value) is skipped.
      if (!event.success) return;
      void fetchImpl(ANALYTICS_ENDPOINT, {
        body: JSON.stringify(event.data),
        cache: "no-store",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
        referrerPolicy: "strict-origin",
      }).catch(() => undefined);
    } catch {
      // A synchronous failure (a keepalive quota error, a missing fetch) never reaches the UI.
    }
  }

  return {
    send,
    sendOnce(name) {
      if (optedOut()) return;
      const key = `${ONCE_KEY_PREFIX}${name}:${context.giftRef}`;
      if (memory.once.has(key) || readItem(storage, key) !== null) return;
      memory.once.add(key);
      writeItem(storage, key, "1");
      send(name);
    },
  };
}
