// @ts-nocheck
/**
 * Quality Score Calculator
 *
 * Computes a 0–100 quality score for an aide based on data completeness.
 * Used by the ingestion pipeline and the recalculate script.
 *
 * Criteria (20 points each, total 100):
 *   1. Titre present and > 10 characters
 *   2. Description present and > 50 characters
 *   3. Source URL present and absolute (starts with http)
 *   4. Organisme / provider present
 *   5. At least 1 theme or category
 */

/**
 * @typedef {Object} QualityBreakdown
 * @property {number} score - Total score (0–100)
 * @property {{ criterion: string, points: number, met: boolean }[]} details
 */

/**
 * Compute quality score for an aide record.
 *
 * @param {Object} aide - Aide data (either raw ingestion data or DB row)
 * @returns {QualityBreakdown}
 */
export function computeQualityScore(aide) {
    if (!aide || typeof aide !== 'object') {
        return { score: 0, details: [] };
    }

    const details = [];

    // 1. Titre present and > 10 characters
    // @ts-ignore
    const title = String(aide.titre || aide.title || '').trim();
    const titleOk = title.length > 10;
    details.push({ criterion: 'titre', points: 20, met: titleOk });

    // 2. Description present and > 50 characters
    const description = String(
        // @ts-ignore
        aide.description || aide.summary_falc || aide.cest_quoi || aide.content || ''
    ).trim();
    const descOk = description.length > 50;
    details.push({ criterion: 'description', points: 20, met: descOk });

    // 3. Source URL present and absolute
    // @ts-ignore
    const sourceUrl = String(aide.source_url || aide.source_url_exact || '').trim();
    const urlOk = sourceUrl.length > 0 && /^https?:\/\//i.test(sourceUrl);
    details.push({ criterion: 'source_url', points: 20, met: urlOk });

    // 4. Organisme / provider present
    const organisme = String(
        // @ts-ignore
        aide.organisme || aide.providerName || aide.provider_name || aide.source_api || ''
    ).trim();
    const organismeOk = organisme.length > 0;
    details.push({ criterion: 'organisme', points: 20, met: organismeOk });

    // 5. At least 1 theme or category
    // @ts-ignore
    const theme = aide.theme || aide.categorie || aide.category || aide.categories;
    let themeOk = false;
    if (Array.isArray(theme)) {
        themeOk = theme.length > 0;
    } else if (typeof theme === 'string') {
        themeOk = theme.trim().length > 0;
    }
    details.push({ criterion: 'theme', points: 20, met: themeOk });

    const score = details.reduce((sum, d) => sum + (d.met ? d.points : 0), 0);

    return { score, details };
}
