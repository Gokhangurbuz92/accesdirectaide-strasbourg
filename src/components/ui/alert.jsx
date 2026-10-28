import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

/** @typedef {'default' | 'destructive'} AlertVariant */
/** @typedef {import("react").ComponentPropsWithoutRef<"div"> & { variant?: AlertVariant }} AlertProps */
/** @typedef {import("react").ComponentPropsWithoutRef<"h5">} AlertTitleProps */
/** @typedef {import("react").ComponentPropsWithoutRef<"div">} AlertDescriptionProps */

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLDivElement, AlertProps>} */
  (({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props} />
  ))
)
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLHeadingElement, AlertTitleProps>} */
  (({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props} />
  ))
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<HTMLDivElement, AlertDescriptionProps>} */
  (({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-sm [&_p]:leading-relaxed", className)}
      {...props} />
  ))
)
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
