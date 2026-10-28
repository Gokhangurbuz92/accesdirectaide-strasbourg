/**
 * Skeleton — Shimmer loading placeholder
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />        — single line
 *   <Skeleton className="h-12 w-12 rounded-full" /> — avatar
 *   <Skeleton variant="card" />               — full card skeleton
 */
function Skeleton({ className = '', variant = 'line' }) {
    if (variant === 'card') {
        return (
            <div className="rounded-2xl border border-slate-100 p-4 space-y-3 animate-pulse">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-200 rounded-full" />
                    <div className="flex-1 space-y-2">
                        <div className="h-3.5 bg-slate-200 rounded w-3/4" />
                        <div className="h-3 bg-slate-100 rounded w-1/2" />
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="h-3 bg-slate-100 rounded w-full" />
                    <div className="h-3 bg-slate-100 rounded w-5/6" />
                </div>
            </div>
        );
    }

    if (variant === 'table-row') {
        return (
            <div className="flex items-center gap-4 py-3 animate-pulse">
                <div className="h-3.5 bg-slate-200 rounded w-1/4" />
                <div className="h-3.5 bg-slate-100 rounded w-1/3" />
                <div className="h-3.5 bg-slate-100 rounded w-1/6" />
                <div className="h-3.5 bg-slate-100 rounded w-1/6" />
            </div>
        );
    }

    return (
        <div
            className={`bg-slate-200 rounded animate-pulse ${className}`}
        />
    );
}

/**
 * SkeletonList — Multiple skeleton items
 */
export function SkeletonList({ count = 3, variant = 'card' }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: count }, (_, i) => (
                <Skeleton key={i} variant={variant} />
            ))}
        </div>
    );
}

export { Skeleton };
export default Skeleton;
