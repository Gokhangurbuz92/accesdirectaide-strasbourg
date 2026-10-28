import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
    "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    {
        variants: {
            variant: {
                neutral:
                    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
                verified:
                    "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
                warning:
                    "border-transparent bg-amber-500 text-black hover:bg-amber-600",
                destructive:
                    "border-transparent bg-destructive text-white hover:bg-destructive/80",
            },
        },
        defaultVariants: {
            variant: "neutral",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    )
}

export { Badge, badgeVariants }
