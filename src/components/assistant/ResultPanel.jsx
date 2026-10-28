// @ts-nocheck
import { ShieldCheck, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import RecommendationCard from './RecommendationCard';

const SECTION_LABELS = {
    aide: 'Aides recommandées',
    demarche: 'Démarches à effectuer',
    structure: 'Structures proches',
};

function groupByType(items) {
    const groups = { aide: [], demarche: [], structure: [] };
    for (const item of items) {
        if (groups[item.type]) {
            groups[item.type].push(item);
        }
    }
    return groups;
}

function LoadingSkeleton() {
    return (
        <div className="space-y-6" aria-busy="true" aria-label="Chargement des recommandations" data-testid="wizard-loading">
            <p className="text-sm font-medium text-slate-600 animate-pulse">Analyse en cours…</p>
            {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-3">
                    <Skeleton className="h-5 w-40" />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Skeleton className="h-28 rounded-xl" />
                        <Skeleton className="h-28 rounded-xl" />
                    </div>
                </div>
            ))}
            <Skeleton className="mt-4 h-32 rounded-xl" />
        </div>
    );
}

function AISummary(/** @type {Record<string, string | number | boolean | null | undefined>} */ { summary }) {
    if (!summary) return null;

    return (
        <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-blue-900">Plan d&apos;action suggéré</h3>
            <div className="text-sm leading-relaxed text-blue-800 whitespace-pre-line">
                {summary}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Ne communiquez jamais de données sensibles (numéro de sécurité sociale, RIB, adresse exacte).
            </div>
        </div>
    );
}

// @ts-ignore
export default function ResultPanel({ items, summary, isLoading, error, onRetry, onRestart }) {
    if (isLoading) {
        return <LoadingSkeleton />;
    }

    if (error) {
        return (
            <EmptyState
                title="Impossible de charger les recommandations"
                description={error}
                actions={
                    <div className="flex gap-2">
                        <Button size="sm" onClick={onRetry}>Réessayer</Button>
                        <Button size="sm" variant="outline" onClick={onRestart}>Recommencer</Button>
                    </div>
                }
            />
        );
    }

    if (!items || items.length === 0) {
        return (
            <EmptyState
                title="Aucune recommandation trouvée"
                description="Nous n'avons pas trouvé de résultats correspondant à votre recherche. Essayez de modifier vos critères."
                actions={
                    <Button size="sm" variant="outline" onClick={onRestart}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Recommencer
                    </Button>
                }
            />
        );
    }

    const groups = groupByType(items);
    const hasAny = Object.values(groups).some((g) => g.length > 0);

    return (
        <div>
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Vos recommandations</h2>
                <Button type="button" variant="ghost" size="sm" onClick={onRestart} className="gap-1 text-xs">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Recommencer
                </Button>
            </div>

            {hasAny ? (
                <div className="space-y-6">
                    {Object.entries(SECTION_LABELS).map(([type, label]) => {
                        const sectionItems = groups[type];
                        if (!sectionItems || sectionItems.length === 0) return null;
                        return (
                            <section key={type} aria-label={label}>
                                <h3 className="mb-3 text-sm font-medium text-slate-600">{label}</h3>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {sectionItems.map((/** @type {{ slug: string | number | boolean | null | undefined }} */ item, idx) => (
                                        <RecommendationCard key={item.slug || idx} item={item} />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            ) : null}

            <AISummary summary={summary} />
        </div>
    );
}
