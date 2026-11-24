// @ts-nocheck
import { Badge } from "@/components/ui/badge";
import { useT } from '@/i18n';
import { topicTone } from '@/design/categoryTone';

/**
 * Unified taxonomy — source of truth for categories.
 * Mirrors api/data/taxonomy.json structure.
 * This is the ONLY place category colors/labels are defined for the UI.
 */
const TAXONOMY = {
    'papiers-citoyennete': { label: 'Papiers - Citoyenneté' },
    'famille': { label: 'Famille' },
    'social-sante': { label: 'Social - Santé' },
    'personnes-agees': { label: 'Personnes âgées' },
    'handicap': { label: 'Handicap' },
    'travail-formation': { label: 'Travail - Formation' },
    'logement': { label: 'Logement' },
    'transports': { label: 'Transports' },
    'argent': { label: 'Argent - Impôts' },
    'justice': { label: 'Justice' },
    'etranger': { label: 'Étranger' },
    'loisirs': { label: 'Loisirs - Sport - Culture' },
    'lgbtqi-plus': { label: 'LGBTQI+' },
};

// Legacy slug aliases → canonical slug
const SLUG_ALIASES = {
    'sante': 'social-sante',
    'santé': 'social-sante',
    'social': 'social-sante',
    'culture': 'loisirs',
    'sport': 'loisirs',
    'credit': 'argent',
    'retraite': 'personnes-agees',
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
 * @returns {{ slug: string, label: string } | null}
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
 * @returns {Array<{ slug: string, label: string }>}
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
    const displayColor = topicTone(resolved?.slug).chip;   // one colour per topic on every page (src/design/categoryTone.js)

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
