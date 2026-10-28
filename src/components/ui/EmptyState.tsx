import * as React from "react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

export interface EmptyStateProps {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
    role?: string;
    "data-testid"?: string;
    /** Q10: 1 when the state IS the page (a detail page that could not be shown); 3 (default) inside a page that has its own heading */
    headingLevel?: 1 | 2 | 3;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
    ({ className, title, description, icon, actions, headingLevel = 3, ...props }, ref) => {
        const Heading = headingLevel === 1 ? motion.h1 : headingLevel === 2 ? motion.h2 : motion.h3;
        return (
            <motion.div
                ref={ref}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                data-testid={props["data-testid"] || "empty-state"}
                role={props.role}
                className={cn(
                    "flex flex-col items-center justify-center text-center py-16 px-6 rounded-3xl border border-dashed border-slate-200/60 bg-slate-50/80 shadow-sm backdrop-blur-sm",
                    className
                )}
            >
                {icon && (
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.1, duration: 0.5, type: "spring", stiffness: 200 }}
                        className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-brand-500 shadow-sm rotate-3 border border-slate-100"
                    >
                        <div className="-rotate-3">
                            {icon}
                        </div>
                    </motion.div>
                )}
                <Heading
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="text-2xl font-bold text-slate-900 mb-3"
                >
                    {title}
                </Heading>
                {description && (
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="text-lg font-light text-slate-600 max-w-md mb-8 leading-relaxed"
                    >
                        {description}
                    </motion.p>
                )}
                {actions && (
                    <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="flex flex-col sm:flex-row items-center gap-3"
                    >
                        {actions}
                    </motion.div>
                )}
            </motion.div>
        )
    }
)
EmptyState.displayName = "EmptyState"

export default EmptyState

