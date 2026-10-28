// @ts-nocheck
/**
 * R16 / D15 — the official legal texts behind each right of the research register, attached from the DILA LEGI open dataset (Licence Ouverte 2.0) by
 * scripts/legi-subset.py: article numbers, the date each version is in force from and a Légifrance link. ATTACHMENT ONLY: nothing shown to the person is
 * computed from these texts (no rule is expert-validated, D11). Décrets and arrêtés are attached as consolidated texts when exactly one in-force text matches;
 * otherwise the reference is said to be not attached.
 */
import index from '../../data/rules/legal-articles.index.v1.json';

const LEGIFRANCE = /^https:\/\/www\.legifrance\.gouv\.fr\/(codes\/article_lc\/LEGIARTI\d{12}|loda\/id\/(JORF|LEGI)TEXT\d{12})$/;
const frDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : null);

/** @returns {{ referenceDate: string|null, source: string, references: Array<{ basis: string, code: string|null, articles: Array<{ num: string, url: string, since: string|null, kind: 'article'|'text' }>, attached: boolean }> } | null} */
export function legalBasisFor(code) {
  const refs = index.references.filter((r) => r.right === code);
  if (!refs.length) return null;
  const s = index.source;
  return {
    referenceDate: frDate(index.referenceDate),
    source: `${s.attribution} — données ${s.dataset}, ${s.licence}`,
    references: refs.map((r) => {
      const articles = (r.articles || []).filter((a) => LEGIFRANCE.test(a.url)).map((a) => ({ num: a.num, url: a.url, since: frDate(a.dateDebut), kind: a.kind === 'text' ? 'text' : 'article' }));
      return { basis: r.basis, code: r.code || null, articles, attached: articles.length > 0 };
    }),
  };
}
