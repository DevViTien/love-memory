"use client";

import { forwardRef } from "react";

import { type StaticGiftBlock } from "./static-gift-content";

type Props = Readonly<{
  blocks: readonly StaticGiftBlock[];
  failedImages: readonly string[];
  onImageError: (assetId: string) => void;
}>;

/**
 * The host-rendered static gift: every value as a text node, no labels, no motion. Images load
 * without a referrer and fall back to their caption, or `Ảnh {n}`.
 */
export const StaticGiftContent = forwardRef<HTMLHeadingElement, Props>(function StaticGiftContent(
  { blocks, failedImages, onImageError },
  headingRef,
) {
  return (
    <section
      aria-label="Nội dung món quà"
      className="h-full overflow-y-auto bg-[#fffaf5] px-5 py-8 text-stone-800 sm:px-10"
      role="region"
    >
      <h2 className="sr-only" ref={headingRef} tabIndex={-1}>
        Nội dung món quà
      </h2>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        {blocks.map((block) =>
          block.kind === "text" ? (
            <p
              className={
                block.multiline
                  ? "text-base leading-7 whitespace-pre-line"
                  : "text-center text-lg font-semibold"
              }
              key={block.fieldId}
            >
              {block.text}
            </p>
          ) : (
            <ul className="flex flex-col gap-6" key={block.fieldId}>
              {block.items.map((item) => (
                <li
                  className="flex flex-col items-center gap-2"
                  key={`${item.assetId}-${item.index}`}
                >
                  {item.url && !failedImages.includes(item.assetId) ? (
                    <>
                      {/* Signed private URLs: next/image would proxy and cache them. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={item.caption ?? `Ảnh ${item.index + 1}`}
                        className="max-h-[70vh] w-full rounded-2xl object-contain"
                        onError={() => onImageError(item.assetId)}
                        referrerPolicy="no-referrer"
                        src={item.url}
                      />
                      {item.caption ? (
                        <p className="text-center text-sm text-stone-600">{item.caption}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="w-full rounded-2xl border border-rose-100 bg-white px-4 py-6 text-center text-sm text-stone-700">
                      {item.fallbackText}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ),
        )}
      </div>
    </section>
  );
});
