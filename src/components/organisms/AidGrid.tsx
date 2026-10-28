import { AidCard } from "@/components/molecules/AidCard";
import type { AidCardProps } from "@/components/molecules/AidCard";
import EmptyState from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export interface AidGridProps {
    items: AidCardProps[];
    hasActiveFilters: boolean;
    onReset?: () => void;
}

export default function AidGrid({
    items,
    hasActiveFilters,
    onReset,
}: AidGridProps) {
    if (items.length === 0 && hasActiveFilters) {
        return (
            <EmptyState
                title="Aucune aide trouvée"
                description="Essayez d'élargir votre recherche ou réinitialisez les filtres."
                icon={<Search className="h-6 w-6" />}
                actions={
                    onReset ? (
                        <Button type="button" variant="outline" onClick={onReset} data-testid="empty-reset">
                            Réinitialiser les filtres
                        </Button>
                    ) : undefined
                }
            />
        );
    }

    if (items.length === 0) {
        return (
            <p className="py-8 text-center text-sm text-muted-foreground">
                Chargement des aides…
            </p>
        );
    }

    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
                <AidCard key={item.href || index} {...item} />
            ))}
        </div>
    );
}
