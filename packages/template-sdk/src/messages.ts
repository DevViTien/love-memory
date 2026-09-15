import { z } from "zod";

export const TEMPLATE_MESSAGE_PROTOCOL_VERSION = 1;

const TemplatePayloadSchema = z.record(z.string(), z.json());

export const TemplateHostMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      context: z
        .object({
          locale: z.string().min(2).max(35),
          prefersReducedMotion: z.boolean(),
        })
        .strict(),
      payload: TemplatePayloadSchema,
      protocolVersion: z.literal(TEMPLATE_MESSAGE_PROTOCOL_VERSION),
      type: z.literal("INIT"),
    })
    .strict(),
  z.object({ type: z.literal("PLAY") }).strict(),
  z.object({ type: z.literal("PAUSE") }).strict(),
  z.object({ type: z.literal("DESTROY") }).strict(),
]);

export const TemplateEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      protocolVersion: z.literal(TEMPLATE_MESSAGE_PROTOCOL_VERSION),
      type: z.literal("READY"),
    })
    .strict(),
  z.object({ sceneId: z.string().min(1).max(80), type: z.literal("SCENE") }).strict(),
  z.object({ type: z.literal("COMPLETE") }).strict(),
  z
    .object({
      code: z.enum(["INVALID_MESSAGE", "RUNTIME_ERROR"]),
      type: z.literal("ERROR"),
    })
    .strict(),
]);

export type TemplateEvent = z.infer<typeof TemplateEventSchema>;
export type TemplateHostMessage = z.infer<typeof TemplateHostMessageSchema>;

export function readTrustedTemplateEvent(
  event: MessageEvent<unknown>,
  expectedSource: MessageEventSource,
): TemplateEvent | undefined {
  if (event.source !== expectedSource) {
    return undefined;
  }

  const parsed = TemplateEventSchema.safeParse(event.data);
  return parsed.success ? parsed.data : undefined;
}

export type TemplateBridgeDependencies = Readonly<{
  onEvent: (event: TemplateEvent) => void;
  postMessage: (message: TemplateHostMessage) => void;
  subscribe: (listener: (event: TemplateEvent) => void) => () => void;
}>;

export function createTemplateBridge({
  onEvent,
  postMessage,
  subscribe,
}: TemplateBridgeDependencies) {
  let unsubscribe: (() => void) | undefined;

  function disconnect() {
    unsubscribe?.();
    unsubscribe = undefined;
  }

  return {
    disconnect,
    destroy() {
      postMessage({ type: "DESTROY" });
      disconnect();
    },
    initialize(payload: z.input<typeof TemplatePayloadSchema>, prefersReducedMotion: boolean) {
      postMessage({
        context: { locale: "vi-VN", prefersReducedMotion },
        payload,
        protocolVersion: TEMPLATE_MESSAGE_PROTOCOL_VERSION,
        type: "INIT",
      });
    },
    pause() {
      postMessage({ type: "PAUSE" });
    },
    play() {
      postMessage({ type: "PLAY" });
    },
    start() {
      unsubscribe ??= subscribe(onEvent);
    },
  } as const;
}
