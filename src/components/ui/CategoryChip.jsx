// @ts-nocheck
import { Badge } from "@/components/ui/badge";
import { useT } from '@/i18n';

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
 * R32: the label of a taxonomy category in the interface language (the French labels above stay the source: resolveCategory and getAllCategories
 * return them). `t` is the caller's translation function (useT('shared')).
 * @param {string | null | undefined} rawSlug @param {(key: string, fallback: string) => string} t
 * @returns {string | null} null when the slug is not a category of the taxonomy
 */
export function categoryLabel(rawSlug, t) {
    const resolved = resolveCategory(rawSlug);
    if (!resolved) return null;
    switch (resolved.slug) {
        case 'papiers-citoyennete': return t('shared:category.papiers-citoyennete', 'Papiers - Citoyenneté');
        case 'famille': return t('shared:category.famille', 'Famille');
        case 'social-sante': return t('shared:category.social-sante', 'Social - Santé');
        case 'personnes-agees': return t('shared:category.personnes-agees', 'Personnes âgées');
        case 'handicap': return t('shared:category.handicap', 'Handicap');
        case 'travail-formation': return t('shared:category.travail-formation', 'Travail - Formation');
        case 'logement': return t('shared:category.logement', 'Logement');
        case 'transports': return t('shared:category.transports', 'Transports');
        case 'argent': return t('shared:category.argent', 'Argent - Impôts');
        case 'justice': return t('shared:category.justice', 'Justice');
        case 'etranger': return t('shared:category.etranger', 'Étranger');
        case 'loisirs': return t('shared:category.loisirs', 'Loisirs - Sport - Culture');
        case 'lgbtqi-plus': return t('shared:category.lgbtqi-plus', 'LGBTQI+');
        default: return resolved.label;
    }
}

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
    const { t } = useT('shared');
    const resolved = resolveCategory(slug);
    if (!resolved && !label) return null;

    const displayLabel = resolved?.label || label;
    const displayColor = resolved?.color || 'bg-slate-100 text-slate-800';

    // Never display "Autre" / "autre" / "À vérifier" / "Non vérifié"
    if (!displayLabel) return null;
    if (/^(autre|à vérifier|non vérifié|date inconnue)$/i.test(displayLabel)) return null;

    // R32: a taxonomy category in the interface language; a label that is not one (from the record) is shown as it is, in French
    const shown = resolved ? categoryLabel(resolved.slug, t) : displayLabel;
    return (
        <Badge className={`${displayColor} ${className}`} lang={resolved ? undefined : 'fr'}>
            {shown}
        </Badge>
    );
}
