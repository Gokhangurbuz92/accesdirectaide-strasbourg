// @vitest-environment jsdom
/**
 * PKG-6 / D11 — the register becomes usable WITHOUT becoming a rule of the product:
 *  - api/lib/rulesDraft.js reads each cited condition as MET / NOT_MET / UNKNOWN (never an eligibility verdict), boundaries included;
 *  - the 30 proposed reference cases (written from the source text, PROPOSED_UNREVIEWED) agree with that reading — a consistency check, NOT a validation;
 *  - no user-facing assessment path imports it, and no right is promoted by being executable;
 *  - the expert review pack is generated from the data and must be in sync;
 *  - the explanation UI links the official pages as « pour en savoir plus », says no expert validated the summary, and that the result is not computed from them.
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { readConditions, ageRangeOfBand, RESULTS } from '../../api/lib/rulesDraft.js';
import { renderReviewPack, PACK_PATH } from '../../scripts/d11-review-pack.mjs';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { officialInfoFor } from '../../src/lib/rightsInfoSources.js';
import AssessmentView from '../../src/components/diagnostic/AssessmentView.jsx';

const reg = JSON.parse(fs.readFileSync('data/rules/rights-rules.v1.json', 'utf8'));
const proposed = JSON.parse(fs.readFileSync('data/rules/reference-cases.proposed.v1.json', 'utf8'));
afterEach(cleanup);

describe('PKG-6 / D11 draft reading of the register', () => {
  it('every proposed reference case (PROPOSED_UNREVIEWED, cited basis) agrees with the draft reading — consistency only', () => {
    expect(proposed.cases.length).toBe(30);
    for (const c of proposed.cases) {
      expect(c.status, c.id).toBe('PROPOSED_UNREVIEWED');
      expect(c.basis.length, c.id).toBeGreaterThan(10);
      const got = Object.fromEntries(readConditions(reg, c.right, c.facts).conditions.map((x) => [x.fact, x.result]));
      for (const [fact, want] of Object.entries(c.expected)) expect(got[fact], `${c.id}.${fact}`).toBe(want);
    }
    expect(new Set(proposed.cases.map((c) => c.right))).toEqual(new Set(reg.rights.map((r) => r.id)));   // every right has proposed cases
  });

  it('the reading never states eligibility: per-condition results only, authoritative:false, unreadable conditions UNKNOWN, unknown facts UNKNOWN', () => {
    for (const r of reg.rights) {
      const out = readConditions(reg, r.id, {});
      expect(out.authoritative).toBe(false);
      expect(Object.keys(out).sort()).toEqual(['authoritative', 'conditions', 'right', 'status']);
      for (const c of out.conditions) { expect(Object.values(RESULTS)).toContain(c.result); expect(c.result, `${r.id}.${c.fact} with no facts`).toBe('UNKNOWN'); }
      expect(JSON.stringify(out)).not.toMatch(/éligible|eligible|vous avez droit/i);
    }
    expect(() => readConditions(reg, 'nope', {})).toThrow(/unknown right/);
  });

  it('declared age bands are read as ranges: a band straddling a threshold is UNKNOWN, never MET', () => {
    const at = (right, band) => readConditions(reg, right, { ageRange: ageRangeOfBand(band) }).conditions.find((c) => c.fact === 'age').result;
    expect(at('apa', '60-et-plus')).toBe('MET'); expect(at('apa', '25-59')).toBe('NOT_MET');
    expect(at('aah', '18-24')).toBe('UNKNOWN'); expect(at('faj-strasbourg', '25-59')).toBe('UNKNOWN'); expect(at('faj-strasbourg', '18-24')).toBe('MET');
    expect(at('prime-activite', 'moins-de-18')).toBe('NOT_MET'); expect(at('rsa', '25-59')).toBe('MET');
    expect(ageRangeOfBand('x')).toBeNull();
  });

  it('nothing user-facing applies it: the assessment modules do not import the draft reader or the register, and every item stays non-authoritative', () => {
    for (const f of ['api/lib/assessmentContract.js', 'api/lib/diagnosticAssessment.js', 'api/lib/shareResults.js', 'src/lib/assessmentLabels.js']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/rulesDraft|rights-rules|reference-cases/);
    }
    const a = buildAssessment({ answers: { birthDate: '1960-01-01', householdSize: 1, income: { salary: 100 }, housing: { status: 'tenant', rent: 300 }, territory: '67000' }, unsupportedRights: UNSUPPORTED_RIGHTS });
    for (const it of a.items) { expect(it.authoritative).toBe(false); expect(it.provenance.source).toBeNull(); expect(it.state).not.toMatch(/ELIGIBLE|NOT_APPLICABLE/); }
    expect(reg.rights.filter((r) => r.status === 'EXPERT_VALIDATED')).toEqual([]);
    expect(reg.rights.every((r) => r.referenceCases.length === 0)).toBe(true);   // proposed cases never land in the register without an expert
  });

  it('the expert review pack is generated from the data and is in sync (re-run: node scripts/d11-review-pack.mjs)', () => {
    const pack = renderReviewPack(reg, proposed);
    expect(fs.readFileSync(PACK_PATH, 'utf8')).toBe(pack);
    expect(pack).toMatch(/aucune règle n'est validée/);
    for (const r of reg.rights) expect(pack).toContain(`(\`${r.id}\`) — RESEARCHED_UNVALIDATED`);
    expect(pack.match(/☐ accepter ☐ corriger ☐ rejeter/g).length).toBe(reg.rights.reduce((n, r) => n + r.conditions.length, 0) + proposed.cases.length);
  });
});

describe('PKG-6 / D11 → D20: official pages in « Pourquoi ce résultat ? »', () => {
  it('info is offered for the 5 rights the assessment shows; only official https pages; status unvalidated', () => {
    for (const code of ['rsa', 'apl', 'faj-strasbourg', 'are', 'apa']) {
      const i = officialInfoFor(code);
      expect(i, code).not.toBeNull(); expect(i.validated).toBe(false);
      for (const p of i.pages) expect(p.url).toMatch(/^https:\/\/(www\.)?(service-public\.gouv\.fr|strasbourg\.eu)\//);
    }
    expect(officialInfoFor('impayes-loyer')).toBeNull();
  });

  it('each item shows the pages (new tab, noopener), who decides, and that the result is not computed from them; axe clean', async () => {
    const assessment = buildAssessment({ answers: { birthDate: '1990-01-01', householdSize: 1, income: { salary: 800 }, housing: { status: 'tenant', rent: 400 }, territory: '67000' }, unsupportedRights: UNSUPPORTED_RIGHTS });
    const { container } = render(createElement(MemoryRouter, null, createElement(AssessmentView, { results: { assessment } })));
    const rsa = screen.getByTestId('official-info-rsa');
    const links = rsa.querySelectorAll('a');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['https://www.service-public.gouv.fr/particuliers/vosdroits/F19778', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F286']);
    for (const a of links) { expect(a).toHaveAttribute('target', '_blank'); expect(a.getAttribute('rel')).toMatch(/noopener/); expect(a).toHaveTextContent(/nouvel onglet/); }
    expect(rsa).toHaveTextContent(/date indiquée sur la page : 01\/04\/2026/);
    expect(rsa).toHaveTextContent(/Qui décide : Caf/);
    expect(screen.getByTestId('official-info-unvalidated-rsa')).toHaveTextContent(/aucun expert ne les a encore validées : le résultat ci-dessus n'est pas calculé à partir d'elles/);
    expect(screen.getByTestId('official-info-are')).toBeInTheDocument();
    expect(screen.getByTestId('official-info-faj-strasbourg').querySelector('a')).toHaveAttribute('href', 'https://www.strasbourg.eu/fr/fond-aide-jeunes');
    expect(screen.queryByTestId('official-info-impayes-loyer')).toBeNull();
    expect(screen.getByTestId('provenance-rsa-source')).toHaveTextContent(/aucune — simulation locale/);   // provenance of the RESULT is unchanged
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
});
