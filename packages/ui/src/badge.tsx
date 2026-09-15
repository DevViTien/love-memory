import { type HTMLAttributes } from "react";

import { cn } from "./lib/cn";

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export function Badge({ className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800",
        className,
      )}
      {...props}
    />
  );
}
