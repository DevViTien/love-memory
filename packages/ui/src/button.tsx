import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "./lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    defaultVariants: {
      size: "md",
      variant: "primary",
    },
    variants: {
      size: {
        lg: "h-12 px-6 text-base",
        md: "h-10 px-5 text-sm",
        sm: "h-8 px-3 text-sm",
      },
      variant: {
        ghost: "text-stone-700 hover:bg-rose-50 hover:text-rose-800",
        outline: "border border-rose-200 bg-white text-rose-800 hover:bg-rose-50",
        primary: "bg-rose-600 text-white shadow-sm hover:bg-rose-700",
      },
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, size, type = "button", variant, ...props },
  ref,
) {
  return (
    <button
      className={cn(buttonVariants({ size, variant }), className)}
      ref={ref}
      type={type}
      {...props}
    />
  );
});
