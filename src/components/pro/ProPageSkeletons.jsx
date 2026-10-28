import { Skeleton } from '../ui/skeleton.jsx';

/**
 * ProPageSkeletons — Volumetric loading placeholders for Pro pages
 *
 * Replaces Loader2 spinners with layout-matching Skeleton screens
 * to eliminate Cumulative Layout Shift (CLS) during page loads.
 *
 * Requirement 7.1 — Excellence Perceptuelle (NF-ADA)
 */

/**
 * ListSkeleton — For pages displaying a list of items
 * Used by: Appointments, Messages, RdvAbsences, Services (list section)
 */
export function ListSkeleton({ count = 4, title = true }) {
    return (
        <div className="space-y-4 animate-pulse">
            {title && <Skeleton className="h-4 w-40 rounded-full mb-2" />}
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-xl" />
                        <div className="space-y-2">
                            <Skeleton className="h-3.5 w-36 rounded-full" />
                            <Skeleton className="h-3 w-24 rounded-full" />
                        </div>
                    </div>
                    <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
            ))}
        </div>
    );
}

/**
 * MessageThreadSkeleton — For chat/thread views
 * Used by: MessageThread
 */
export function MessageThreadSkeleton() {
    return (
        <div className="space-y-4 animate-pulse">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                    <Skeleton className="h-3.5 w-32 rounded-full" />
                    <Skeleton className="h-3 w-20 rounded-full" />
                </div>
            </div>
            {/* Messages */}
            <div className="space-y-3 px-4">
                <div className="flex justify-end">
                    <Skeleton className="h-12 w-48 rounded-2xl rounded-tr-sm" />
                </div>
                <div className="flex justify-start">
                    <Skeleton className="h-16 w-56 rounded-2xl rounded-tl-sm" />
                </div>
                <div className="flex justify-end">
                    <Skeleton className="h-10 w-40 rounded-2xl rounded-tr-sm" />
                </div>
                <div className="flex justify-start">
                    <Skeleton className="h-12 w-52 rounded-2xl rounded-tl-sm" />
                </div>
            </div>
            {/* Input bar */}
            <div className="flex items-center gap-2 p-4 border-t border-slate-100">
                <Skeleton className="h-10 flex-1 rounded-xl" />
                <Skeleton className="h-10 w-10 rounded-xl" />
            </div>
        </div>
    );
}

/**
 * FormSkeleton — For settings/form pages
 * Used by: Structure, RdvNew, Services (settings section)
 */
export function FormSkeleton({ fields = 4 }) {
    return (
        <div className="space-y-6 animate-pulse">
            <Skeleton className="h-5 w-48 rounded-full" />
            {Array.from({ length: fields }, (_, i) => (
                <div key={i} className="space-y-2">
                    <Skeleton className="h-3.5 w-24 rounded-full" />
                    <Skeleton className="h-10 w-full rounded-xl" />
                </div>
            ))}
            <div className="flex justify-end pt-4">
                <Skeleton className="h-10 w-32 rounded-xl" />
            </div>
        </div>
    );
}

/**
 * GridSkeleton — For time-grid / availability views
 * Used by: Availability
 */
export function GridSkeleton({ cols = 5, rows = 4 }) {
    return (
        <div className="space-y-4 animate-pulse">
            <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-48 rounded-full" />
                <Skeleton className="h-9 w-28 rounded-xl" />
            </div>
            {/* Column headers */}
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                {Array.from({ length: cols }, (_, i) => (
                    <Skeleton key={`h-${i}`} className="h-8 rounded-lg" />
                ))}
            </div>
            {/* Grid cells */}
            {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                    {Array.from({ length: cols }, (_, c) => (
                        <Skeleton key={`${r}-${c}`} className="h-10 rounded-lg" />
                    ))}
                </div>
            ))}
        </div>
    );
}
