import type { FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface FilterState {
    search: string;
    category: string;
    urgentOnly: boolean;
}

export interface FilterPanelProps {
    filters: FilterState;
    onChange: (next: FilterState) => void;
    onReset: () => void;
}

/**
 * All 13 canonical categories — mirrors api/data/taxonomy.json.
 * This is the single source of truth for sidebar category filters.
 */
const CATEGORIES = [
    { value: "", label: "Toutes les catégories" },
    { value: "papiers-citoyennete", label: "Papiers - Citoyenneté" },
    { value: "famille", label: "Famille" },
    { value: "social-sante", label: "Social - Santé" },
    { value: "personnes-agees", label: "Personnes âgées" },
    { value: "handicap", label: "Handicap" },
    { value: "travail-formation", label: "Travail - Formation" },
    { value: "logement", label: "Logement" },
    { value: "transports", label: "Transports" },
    { value: "argent", label: "Argent - Impôts" },
    { value: "justice", label: "Justice" },
    { value: "etranger", label: "Étranger" },
    { value: "loisirs", label: "Loisirs - Sport - Culture" },
    { value: "lgbtqi-plus", label: "LGBTQI+" },
] as const;

export default function FilterPanel({
    filters,
    onChange,
    onReset,
}: FilterPanelProps) {
    const handleSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
    };

    return (
        <aside aria-label="Filtres" className="space-y-6">
            {/* Search */}
            <form onSubmit={handleSearchSubmit}>
                <label htmlFor="filter-search" className="sr-only">
                    Rechercher une aide
                </label>
                <Input
                    id="filter-search"
                    type="search"
                    placeholder="Rechercher…"
                    value={filters.search}
                    onChange={(e) => onChange({ ...filters, search: e.target.value })}
                />
            </form>

            {/* Category */}
            <div>
                <label
                    htmlFor="filter-category"
                    className="mb-1 block text-sm font-medium text-foreground"
                >
                    Catégorie
                </label>
                <select
                    id="filter-category"
                    value={filters.category}
                    onChange={(e) => onChange({ ...filters, category: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                            {cat.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* Urgency */}
            <fieldset>
                <legend className="mb-1 text-sm font-medium text-foreground">
                    Priorité
                </legend>
                <label
                    htmlFor="filter-urgent"
                    className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                >
                    <input
                        id="filter-urgent"
                        type="checkbox"
                        checked={filters.urgentOnly}
                        onChange={(e) =>
                            onChange({ ...filters, urgentOnly: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    Urgence uniquement
                </label>
            </fieldset>

            {/* Reset */}
            <Button type="button" variant="outline" className="w-full" onClick={onReset}>
                Réinitialiser les filtres
            </Button>
        </aside>
    );
}
