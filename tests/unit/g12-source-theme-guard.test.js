/**
 * G12.1 (live incident 20/11/2026 ~02:00Z): after the G12 release GET /api/public/indicators answered 500 — the Production theme « Social - Santé, Financement »
 * (a comma) failed assertAggregateOnly, and one refused string took the whole endpoint down. Rolled back to G11 within minutes.
 * Now: (1) the guard admits a comma inside a label (e-mails, links and phone numbers are still refused); (2) the service never lets one source theme break
 * the answer: if any theme would be refused, the theme breakdown is omitted (null) and the other indicators are served.
 */
import { describe, expect, it } from 'vitest';
import { assertAggregateOnly } from '../../api/lib/public-indicators.js';
import { safeSourceThemes } from '../../api/_services/public-indicators.js';

// the exact themes of the 114 Production aides on 20/11/2026 (public /api/aides)
const PRODUCTION_THEMES = ['Famille - Scolarité', 'Social - Santé', 'Argent - Impôts - Consommation', 'Logement', 'Transports - Mobilité', 'Loisirs - Sports - Culture',
  'Social - Santé, Financement', 'Justice', 'Travail - Formation', 'Papiers - Citoyenneté - Élections'];

describe('G12.1: source themes and the aggregate-only guard', () => {
  it('every Production theme passes the guard', () => {
    for (const t of PRODUCTION_THEMES) expect(() => assertAggregateOnly({ aidesBySourceTheme: [{ theme: t, count: 1 }] }), t).not.toThrow();
  });
  it('the guard still refuses e-mails, links and phone numbers, with or without a comma', () => {
    for (const v of ['contact@example.fr', 'Logement, www.example.fr', 'Appelez le 03 88 12 34 56', 'Social, https://x.fr']) expect(() => assertAggregateOnly({ x: v }), v).toThrow();
  });
  it('one refused theme hides the theme breakdown instead of failing the whole answer', () => {
    const rows = [{ theme: 'Logement', count: 3 }, { theme: 'Écrire à contact@example.fr', count: 1 }];
    expect(safeSourceThemes(rows)).toBeNull();
    expect(safeSourceThemes([{ theme: 'Social - Santé, Financement', count: 2 }, { theme: null, count: 1 }])).toEqual([{ theme: 'Social - Santé, Financement', count: 2 }, { theme: null, count: 1 }]);
  });
});
