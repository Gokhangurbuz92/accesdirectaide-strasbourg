import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button";

/** @param {any} props */
const Pagination = (props) => {
  const { className, ...rest } = props || {};
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...rest} />
  );
}
Pagination.displayName = "Pagination"

/** @param {any} props @param {any} ref */
function PaginationContentImpl(props, ref) {
  const { className, ...rest } = props || {};
  return (
    <ul
      ref={ref}
      className={cn("flex flex-row items-center gap-1", className)}
      {...rest} />
  );
}

const PaginationContent = React.forwardRef(PaginationContentImpl)
PaginationContent.displayName = "PaginationContent"

/** @param {any} props @param {any} ref */
function PaginationItemImpl(props, ref) {
  const { className, ...rest } = props || {};
  return <li ref={ref} className={cn("", className)} {...rest} />;
}

const PaginationItem = React.forwardRef(PaginationItemImpl)
PaginationItem.displayName = "PaginationItem"

/** @param {any} props */
const PaginationLink = (props) => {
  const {
    className,
    isActive,
    size = "icon",
    ...rest
  } = props || {};

  return (
    <a
      aria-current={isActive ? "page" : undefined}
      className={cn(buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }), className)}
      {...rest} />
  );
}
PaginationLink.displayName = "PaginationLink"

/** @param {any} props */
const PaginationPrevious = (props) => {
  const { className, ...rest } = props || {};
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn("gap-1 pl-2.5", className)}
      {...rest}>
      <ChevronLeft className="h-4 w-4" />
      <span>Previous</span>
    </PaginationLink>
  );
}
PaginationPrevious.displayName = "PaginationPrevious"

/** @param {any} props */
const PaginationNext = (props) => {
  const { className, ...rest } = props || {};
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn("gap-1 pr-2.5", className)}
      {...rest}>
      <span>Next</span>
      <ChevronRight className="h-4 w-4" />
    </PaginationLink>
  );
}
PaginationNext.displayName = "PaginationNext"

/** @param {any} props */
const PaginationEllipsis = (props) => {
  const { className, ...rest } = props || {};
  return (
    <span
      aria-hidden
      className={cn("flex h-9 w-9 items-center justify-center", className)}
      {...rest}>
      <MoreHorizontal className="h-4 w-4" />
      <span className="sr-only">More pages</span>
    </span>
  );
}
PaginationEllipsis.displayName = "PaginationEllipsis"

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}
