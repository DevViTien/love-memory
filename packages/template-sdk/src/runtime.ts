export type RuntimeContext = Readonly<{
  locale: string;
  prefersReducedMotion: boolean;
  reportScene: (sceneId: string) => void;
  resolveAsset: (assetId: string, width: number) => string;
  signal: AbortSignal;
}>;

export type TemplatePayload = Readonly<Record<string, unknown>>;

export interface TemplateRuntime<TPayload extends TemplatePayload = TemplatePayload> {
  destroy(): void;
  mount(root: HTMLElement, payload: TPayload, context: RuntimeContext): Promise<void>;
  pause(): void;
  play(): Promise<void>;
  seek?(sceneId: string): void;
}
