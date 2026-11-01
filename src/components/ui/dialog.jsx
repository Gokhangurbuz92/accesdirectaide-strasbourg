// @ts-nocheck
"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useT } from "@/i18n"

/** @typedef {import("react").ElementRef<typeof DialogPrimitive.Overlay>} DialogOverlayElement */
/** @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>} DialogOverlayProps */
/** @typedef {import("react").ElementRef<typeof DialogPrimitive.Content>} DialogContentElement */
/** @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Content>} DialogContentProps */
/** @typedef {import("react").ElementRef<typeof DialogPrimitive.Title>} DialogTitleElement */
/** @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Title>} DialogTitleProps */
/** @typedef {import("react").ElementRef<typeof DialogPrimitive.Description>} DialogDescriptionElement */
/** @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Description>} DialogDescriptionProps */

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

/** R32: the name of the close button, for screen readers, in the interface language (it used to be the English « Close ») */
function DialogCloseLabel() {
  const { t } = useT('shared')
  return <span className="sr-only">{t('shared:dialog.close', 'Fermer')}</span>
}

const DialogOverlay = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<DialogOverlayElement, DialogOverlayProps>} */
  (({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props} />
  ))
)
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<DialogContentElement, DialogContentProps>} */
  (({ className, children, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        {...props}>
        {children}
        <DialogPrimitive.Close
          className="absolute end-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <DialogCloseLabel />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  ))
)
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-start", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 rtl:space-x-reverse", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<DialogTitleElement, DialogTitleProps>} */
  (({ className, ...props }, ref) => (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props} />
  ))
)
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(
  /** @type {import("react").ForwardRefRenderFunction<DialogDescriptionElement, DialogDescriptionProps>} */
  (({ className, ...props }, ref) => (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props} />
  ))
)
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
