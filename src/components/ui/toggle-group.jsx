"use client";
import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"

import { cn } from "@/lib/utils"
import { useLanguage } from "@/i18n"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext(/** @type {Pick<NonNullable<Parameters<typeof toggleVariants>[0]>, "variant" | "size">} */ ({
  size: "default",
  variant: "default",
}))

const ToggleGroup = React.forwardRef((/** @type {React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & Pick<NonNullable<Parameters<typeof toggleVariants>[0]>, "variant" | "size">} */ { className, variant, size, children, ...props }, ref) => {
  const { dir } = useLanguage();   // FA-RTL: Radix defaults to dir="ltr" without a DirectionProvider — arrow keys follow the reading order
  return (
  <ToggleGroupPrimitive.Root
    ref={ref}
    dir={dir}
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}>
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
  );
})

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef((/** @type {React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & Pick<NonNullable<Parameters<typeof toggleVariants>[0]>, "variant" | "size">} */ { className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    (<ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(toggleVariants({
        variant: context.variant || variant,
        size: context.size || size,
      }), className)}
      {...props}>
      {children}
    </ToggleGroupPrimitive.Item>)
  );
})

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }
