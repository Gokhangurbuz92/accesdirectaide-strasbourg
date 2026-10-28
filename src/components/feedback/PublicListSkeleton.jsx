// @ts-nocheck
import { Skeleton } from '@/components/ui/skeleton';

/**
 * PublicListSkeleton
 * Grille de Skeletons accessibles pour remplacer les Loader2 spinners
 * sur les pages publiques. Évite le CLS et fournit un feedback visuel contextuel.
 * @param {number} count - Nombre de cartes skeleton à afficher
 */
// @ts-ignore
export default function PublicListSkeleton({ count = 6, ariaLabel = 'Chargement du contenu' }) {
    return (
        <div
            className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
            role="status"
            aria-label={ariaLabel}
        >
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    className="space-y-4 rounded-xl border border-border bg-card p-6"
                    aria-hidden="true"
                >
                    {/* Tag */}
                    <Skeleton className="h-4 w-20 rounded-full" />
                    {/* Title */}
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-full rounded-lg" />
                        <Skeleton className="h-5 w-3/4 rounded-lg" />
                    </div>
                    {/* Description */}
                    <div className="space-y-2">
                        <Skeleton className="h-3 w-full rounded-full" />
                        <Skeleton className="h-3 w-full rounded-full" />
                        <Skeleton className="h-3 w-2/3 rounded-full" />
                    </div>
                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2">
                        <Skeleton className="h-3 w-24 rounded-full" />
                        <Skeleton className="h-8 w-8 rounded-lg" />
                    </div>
                </div>
            ))}
            <span className="sr-only">Le contenu est en cours de chargement…</span>
        </div>
    );
}
