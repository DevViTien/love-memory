import { type HTMLAttributes } from "react";

import { cn } from "./lib/cn";

export type ContainerProps = HTMLAttributes<HTMLDivElement>;

export function Container({ className, ...props }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-10", className)} {...props} />
  );
}
