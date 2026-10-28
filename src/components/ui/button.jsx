import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

/** @typedef {'solid' | 'outline' | 'ghost' | 'secondary' | 'destructive' | 'link'} ButtonVariant */
/** @typedef {'default' | 'sm' | 'lg' | 'icon'} ButtonSize */
/**
 * @typedef {import("react").ButtonHTMLAttributes<HTMLButtonElement> & {
 *   variant?: ButtonVariant;
 *   size?: ButtonSize;
 *   asChild?: boolean;
 * }} ButtonProps
 */

/** @typedef {{ variant?: ButtonVariant; size?: ButtonSize; className?: string }} ButtonVariantsOptions */

const ButtonVariants = /** @type {Record<ButtonVariant, string>} */ ({
  solid: "bg-bt-primary text-white hover:bg-bt-primaryHover",
  outline: "border border-bt-border bg-bt-surface text-bt-ink hover:bg-bt-background",
  ghost: "bg-transparent text-bt-ink hover:bg-bt-background",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  link: "bg-transparent text-bt-primary hover:underline underline-offset-4",
});

const ButtonSizes = /** @type {Record<ButtonSize, string>} */ ({
  default: "",
  sm: "min-h-[36px] px-3 py-1.5 text-xs rounded-md",
  lg: "min-h-[48px] px-6 py-3 text-base rounded-xl",
  icon: "h-9 w-9 min-h-0 px-0 py-0",
});

/** @param {ButtonVariantsOptions} [options] */
export function buttonVariants(options) {
  const { variant = "solid", size = "default", className = "" } = options || {};

  const base =
    "inline-flex items-center justify-center rounded-lg px-4 py-2 min-h-[44px] text-sm font-medium " +
    "transition-colors duration-240 ease-apple disabled:opacity-50 disabled:pointer-events-none " +
    "motion-reduce:transform-none motion-reduce:transition-none";

  const focus =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bt-accent " +
    "focus-visible:ring-offset-2 ring-offset-bt-surface";

  return `${base} ${focus} ${ButtonVariants[variant]} ${ButtonSizes[size]} ${className}`.trim();
}

export const Button = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLButtonElement, ButtonProps>} */
  (({ className = "", variant = "solid", size = "default", asChild = false, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center rounded-lg px-4 py-2 min-h-[44px] text-sm font-medium " +
      "transition-colors duration-240 ease-apple disabled:opacity-50 disabled:pointer-events-none " +
      "motion-reduce:transform-none motion-reduce:transition-none";

    const focus =
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bt-accent " +
      "focus-visible:ring-offset-2 ring-offset-bt-surface";

    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        className={`${base} ${focus} ${ButtonVariants[variant]} ${ButtonSizes[size]} ${className}`.trim()}
        {...props}
      />
    );
  })
);

Button.displayName = "Button";
