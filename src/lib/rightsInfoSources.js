// @ts-nocheck
/**
 * PKG-6 / D11 → D20 — official pages to READ about a right, from the research register (data/rules/rights-rules.v1.json). INFORMATION ONLY: the result shown
 * to the person is never computed from these pages or from the register (no rule is expert-validated), so the UI presents them as « pour en savoir plus »,
 * says the summary of the rules was not validated by an expert, and names who decides. Only https links on official domains are returned.
 */
import register from '../../data/rules/rights-rules.v1.json';

const OFFICIAL = /^https:\/\/(www\.)?(service-public\.gouv\.fr|legifrance\.gouv\.fr|caf\.fr|francetravail\.fr|unedic\.org|ameli\.fr|solidarites\.gouv\.fr|alsace\.eu|strasbourg\.eu|bas-rhin\.gouv\.fr)\//;
const host = (u) => new URL(u).hostname.replace(/^www\./, '');
const frDate = (d) => (d ? d.split('-').reverse().join('/') : null);

/** @returns {{ status: string, validated: boolean, decidedBy: string, pages: Array<{ url: string, site: string, pageDate: string|null, scope: string|null }> } | null} */
export function officialInfoFor(code) {
  const r = register.rights.find((x) => x.id === code);
  if (!r) return null;
  const pages = r.sources.filter((s) => OFFICIAL.test(s.url)).map((s) => ({ url: s.url, site: host(s.url), pageDate: frDate(s.pageVerifiedOn), scope: s.scope || null }));
  if (!pages.length) return null;
  return { status: r.status, validated: r.status === 'EXPERT_VALIDATED', decidedBy: r.decidedBy, pages };
}
