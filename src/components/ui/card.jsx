import * as React from "react";
import { cn } from "@/lib/utils";

/** @typedef {import("react").ComponentPropsWithoutRef<"div">} DivProps */
/** @typedef {import("react").ComponentPropsWithoutRef<"h3">} H3Props */
/** @typedef {import("react").ComponentPropsWithoutRef<"p">} PProps */

const Card = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
  (function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border border-bt-border bg-bt-background text-bt-ink shadow-sm",
          className
        )}
        {...props}
      />
    );
  })
);

const CardHeader = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
  (function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-1.5 p-6", className)}
        {...props}
      />
    );
  })
);

const CardTitle = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLHeadingElement, H3Props & { as?: 'h1' | 'h2' | 'h3' }>} */
  (function CardTitle({ className, as: Tag = 'h3', ...props }, ref) {
    // PKG-11 audit pass 2: a page whose only title is its card (sign-in, sign-up, password pages) gives it level 1 (as="h1"); it had no level-1 heading at all
    return (
      <Tag
        ref={ref}
        className={cn(
          "text-base font-semibold leading-none tracking-tight",
          className
        )}
        {...props}
      />
    );
  })
);

const CardDescription = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLParagraphElement, PProps>} */
  (function CardDescription({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        className={cn("text-sm text-slate-600", className)}
        {...props}
      />
    );
  })
);

const CardContent = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
  (function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />;
  })
);

const CardFooter = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
  (function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("flex items-center p-6 pt-0", className)}
        {...props}
      />
    );
  })
);

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
