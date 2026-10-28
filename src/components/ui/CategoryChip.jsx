// @ts-nocheck
import { Badge } from "@/components/ui/badge";

/**
 * Unified taxonomy — source of truth for categories.
 * Mirrors api/data/taxonomy.json structure.
 * This is the ONLY place category colors/labels are defined for the UI.
 */
const TAXONOMY = {
    'papiers-citoyennete': { label: 'Papiers - Citoyenneté', color: 'bg-slate-100 text-slate-800' },
    'famille': { label: 'Famille', color: 'bg-pink-100 text-pink-800' },
    'social-sante': { label: 'Social - Santé', color: 'bg-green-100 text-green-800' },
    'personnes-agees': { label: 'Personnes âgées', color: 'bg-amber-100 text-amber-800' },
    'handicap': { label: 'Handicap', color: 'bg-purple-100 text-purple-800' },
    'travail-formation': { label: 'Travail - Formation', color: 'bg-blue-100 text-blue-800' },
    'logement': { label: 'Logement', color: 'bg-orange-100 text-orange-800' },
    'transports': { label: 'Transports', color: 'bg-cyan-100 text-cyan-800' },
    'argent': { label: 'Argent - Impôts', color: 'bg-yellow-100 text-yellow-800' },
    'justice': { label: 'Justice', color: 'bg-red-100 text-red-800' },
    'etranger': { label: 'Étranger', color: 'bg-teal-100 text-teal-800' },
    'loisirs': { label: 'Loisirs - Sport - Culture', color: 'bg-indigo-100 text-indigo-800' },
    'lgbtqi-plus': { label: 'LGBTQI+', color: 'bg-fuchsia-100 text-fuchsia-800' },
};

// Legacy slug aliases → canonical slug
const SLUG_ALIASES = {
    'sante': 'social-sante',
    'emploi': 'travail-formation',
    'budget': 'argent',
    'mobilite': 'transports',
    'mobilité': 'transports',
    'numerique': 'loisirs',
    'numérique': 'loisirs',
    'etrangers': 'etranger',
    'vieillissement': 'personnes-agees',
    'isolement': 'social-sante',
    'lgbtqia': 'lgbtqi-plus',
    'lgbtqi': 'lgbtqi-plus',
    'lgbt': 'lgbtqi-plus',
    'queer': 'lgbtqi-plus',
    'insertion': 'travail-formation',
    'droits': 'justice',
    'administratif': 'papiers-citoyennete',
    'papiers': 'papiers-citoyennete',
    'entreprises': 'travail-formation',
};

/**
 * Resolve a raw category slug to its canonical taxonomy entry.
 * @param {string|null|undefined} rawSlug
 * @returns {{ slug: string, label: string, color: string } | null}
 */
export function resolveCategory(rawSlug) {
    if (!rawSlug) return null;
    const slug = String(rawSlug).trim().toLowerCase().replace(/^autre$/i, '');
    if (!slug) return null;
    // Direct match
    // @ts-ignore
    if (TAXONOMY[slug]) return { slug, ...TAXONOMY[slug] };
    // Alias match
    const canonical = SLUG_ALIASES[slug];
    // @ts-ignore
    if (canonical && TAXONOMY[canonical]) return { slug: canonical, ...TAXONOMY[canonical] };
    // No match — don't display "Autre"
    return null;
}

/**
 * Get all categories for filter dropdowns.
 * @returns {Array<{ slug: string, label: string, color: string }>}
 */
export function getAllCategories() {
    return Object.entries(TAXONOMY).map(([slug, v]) => ({ slug, ...v }));
}

/**
 * CategoryChip — unified category badge used across all cards and pages.
 *
 * @param {{ slug?: string, label?: string, className?: string }} props
 */
export default function CategoryChip({ slug, label, className = '' }) {
    const resolved = resolveCategory(slug);
    if (!resolved && !label) return null;

    const displayLabel = resolved?.label || label;
    const displayColor = resolved?.color || 'bg-slate-100 text-slate-800';

    // Never display "Autre" / "autre" / "À vérifier" / "Non vérifié"
    if (!displayLabel) return null;
    if (/^(autre|à vérifier|non vérifié|date inconnue)$/i.test(displayLabel)) return null;

    return (
        <Badge className={`${displayColor} ${className}`}>
            {displayLabel}
        </Badge>
    );
}
