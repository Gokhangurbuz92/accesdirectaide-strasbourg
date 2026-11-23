/**
 * G14-OBS — a synthetic public observatoire answer built with the REAL publication functions (api/lib/demand-signals.js + the C8 marginal protection).
 * Synthetic counts only; no person, no record. Used by the unit tests of the registry, the CSV, the handlers and the page.
 */
import * as L from '../../api/lib/demand-signals.js';
import { alignColumns, protectMarginals } from '../../api/_services/territorial-stats.js';

const protect = (a, c) => { const [x, y] = alignColumns(a, c); return protectMarginals(x, y, { lowerA: 0, lowerC: 0, kMin: 5 }); };

/** a synthetic public answer built with the real publication functions */
export function sampleBody() {
  const rows = [
    ...Array.from({ length: 30 }, () => ({ code: 'aide-alimentaire', commune: '67482', n: 1 })),
    { code: 'aide-alimentaire', commune: '67447', n: 6 }, { code: 'aide-alimentaire', commune: '', n: 9 }, { code: 'urgence-sociale', commune: '', n: 2 },
    { code: 'violences-conjugales', commune: '', n: 7 },
  ];
  const search = L.publishSearches(rows, protect);
  const supply = { computedAt: '2026-11-23T08:00:00.000Z', places: 120, outsideEurometropole: 30, unlocated: null,
    byDomain: [...L.socialReference().domains, 'non_classe'].map((d) => ({ domain: d, places: d === 'precarite' ? 0 : d === 'logement' ? 12 : null, bookable: 0, hours: null })),
    byCommune: L.emsCommunes().map((c) => ({ commune: c.code, places: c.code === '67482' ? 80 : null, byDomain: Object.fromEntries([...L.socialReference().domains, 'non_classe'].map((d) => [d, 0])) })) };
  const quarter = { quarter: '2026-T3', frozenAt: '2026-10-01T06:17:00Z', collected: { search: { from: '2026-07-01', to: '2026-09-30' }, situation: null, parcours: { from: '2026-08-02', to: '2026-09-29' }, referral: null },
    search, categories: L.publishCodes('search_category', [{ code: 'LOGEMENT', n: 12 }]), situations: null,
    parcoursAdded: L.publishCodes('parcours_added', [{ code: 'RSA_DEMANDE', n: 8 }, { code: 'FSL_DEMANDE', n: 6 }]), parcoursClosed: L.publishCodes('parcours_closed', [{ code: 'RSA_DEMANDE', n: 5 }]),
    referrals: null, bookings: { byDomain: [...L.socialReference().domains, 'non_classe'].map((d) => ({ domain: d, requested: null, bookablePlaces: 0 })) },
    supplyAtFreeze: { computedAt: supply.computedAt, byDomain: supply.byDomain.map((d) => ({ domain: d.domain, places: d.places })) }, gaps: L.computeGaps(search, supply) };
  return { schema: L.SCHEMA, computedAt: '2026-11-23T08:00:00.000Z', licence: L.LICENCE, territory: { epci: L.EMS_EPCI, communes: L.emsCommunes().map((c) => ({ code: c.code, label: c.nom })) },
    rules: { kMin: 5, communeTableMin: 20, supplyBand: '1-4', closedQuartersOnly: true }, collecting: true,
    codes: { domains: [...L.socialReference().domains, 'non_classe'], situations: L.codesOf('situation'), categories: L.codesOf('search_category'), parcours: L.codesOf('parcours_added'), referralReasons: L.codesOf('social_referral') },
    quarters: [quarter], supply };
}

