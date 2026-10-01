import { splitParagraphs } from "./format";
import type { MemoryBoxContent } from "./payload";

export const FATAL_MESSAGE = "Món quà chưa hiển thị được. Hãy tải lại trang để thử lại.";

export function receiverHeading(content: MemoryBoxContent | undefined): string {
  return `Gửi ${content?.receiverName ?? "bạn"}`;
}

/** Replaces the whole template with one fixed sentence; used when nothing else can render. */
export function renderFatal(root: HTMLElement): void {
  const message = root.ownerDocument.createElement("p");
  message.className = "fatal";
  message.textContent = FATAL_MESSAGE;
  root.replaceChildren(message);
}

/**
 * Replaces the whole template with static, motion-free text in reading order: the receiver
 * heading, the date, the opening message, every caption, then the letter. No images are shown.
 */
export function renderStaticFallback(
  root: HTMLElement,
  content: MemoryBoxContent | undefined,
): void {
  if (!content) {
    renderFatal(root);
    return;
  }

  const document = root.ownerDocument;
  const text = (tagName: "h1" | "li" | "p", value: string, className?: string) => {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };
  const article = document.createElement("article");
  article.className = "fallback";
  article.append(text("h1", receiverHeading(content), "title"));
  if (content.date) article.append(text("p", content.date, "date"));
  if (content.openingMessage) article.append(text("p", content.openingMessage));

  const captions = content.memories.flatMap((memory) => (memory.caption ? [memory.caption] : []));
  if (captions.length > 0) {
    const list = document.createElement("ul");
    list.className = "captions";
    list.append(...captions.map((caption) => text("li", caption)));
    article.append(list);
  }
  for (const paragraph of splitParagraphs(content.finalLetter ?? "")) {
    article.append(text("p", paragraph));
  }
  root.replaceChildren(article);
}

export type ErrorBoundary = Readonly<{
  /** Wraps a callback so that anything it throws goes to the failure path instead of escaping. */
  guard: <TArgs extends unknown[]>(callback: (...args: TArgs) => void) => (...args: TArgs) => void;
}>;

export function createErrorBoundary(onFailure: (error: unknown) => void): ErrorBoundary {
  return {
    guard:
      (callback) =>
      (...args) => {
        try {
          callback(...args);
        } catch (error) {
          onFailure(error);
        }
      },
  };
}
