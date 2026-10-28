/**
 * DTA S1 stage 1 — result-state / provenance contract.  Negative tests first (PRODUCT_FLOW_CONTRACT v0.3: N1 N2 N3 N6 N8 N13 N15 + invariants).
 * Uses the REAL LocalRulesEngine (frozen heuristics) as the source of "tempting" eligibility outcomes; nothing here is a legal rule.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runLocalSimulation } from '../../api/lib/LocalRulesEngine.js';
import {
  AMOUNT_STATUS, AUTHORITATIVE_STATES, NOT_AVAILABLE, PROVENANCE_FIELDS, STATES,
  assertAssessmentItem, buildAssessment, engineUnavailableAssessment,
} from '../../api/lib/assessmentContract.js';

const base = (o = {}) => ({ birthDate: '1990-01-01', householdSize: 1, income: { salary: 0, unemployment: 700 }, housing: { status: 'tenant', rent: 480, charges: 0 }, territory: '67000', ...o });
const run = (answers, leadsEnabled) => buildAssessment({ simulation: runLocalSimulation(answers), answers, leadsEnabled });
const GRID = [];
for (const birthDate of ['2008-05-05', '2002-03-03', '1990-01-01', '1950-06-06'])
  for (const salary of [0, 900, 5000])
    for (const unemployment of [0, 700])
      for (const status of ['tenant', 'tenant_hlm', 'owner', 'free'])
        for (const territory of ['67000', '67200', '75001', '68000'])
          for (const householdSize of [1, 3])
            GRID.push({ birthDate, householdSize, income: { salary, unemployment }, housing: { status, rent: 650, charges: 30 }, territory });

describe('N1/N3 — the local heuristic can never yield authority, proven inapplicability or an amount', () => {
  it('over a grid of inputs, leads on AND off: no authoritative state, authoritative:false, amount null', () => {
    expect(GRID.length).toBeGreaterThan(500);
    for (const answers of GRID) for (const leads of [false, true]) {
      const a = run(answers, leads);
      expect(a.authoritative).toBe(false);
      expect(a.totals).toBeNull();
      for (const it of a.items) {
        expect(AUTHORITATIVE_STATES).not.toContain(it.state);
        expect(it.authoritative).toBe(false);
        expect(it.amount).toBeNull();
        expect(it.amountStatus).toBe(AMOUNT_STATUS);
      }
    }
  });
  it('the engine really does produce tempting amounts/eligibility on this grid (so the test is not vacuous)', () => {
    const hits = GRID.map((g) => runLocalSimulation(g).rights).flat();
    expect(hits.some((r) => r.eligible === true && r.amount > 0)).toBe(true);
    expect(hits.some((r) => r.eligible === false)).toBe(true);
  });
  it('no engine amount reaches the output (serialized assessment contains none of the engine amounts as a value)', () => {
    const answers = base({ income: { salary: 0, unemployment: 0 } });
    const sim = runLocalSimulation(answers);
    const amounts = sim.rights.map((r) => r.amount).filter((n) => n > 0);
    expect(amounts.length).toBeGreaterThan(0);
    const json = JSON.stringify(buildAssessment({ simulation: sim, answers, leadsEnabled: true }));
    for (const n of amounts) expect(json).not.toMatch(new RegExp(`:\\s*${String(n).replace('.', '\\.')}[,}]`));
    expect(json).not.toMatch(/€|\beuros?\b/i);   // DTA S2A: word-bounded (the declared territory 'Eurométropole de Strasbourg' is not money); intent unchanged
  });
});

describe('leads are DISABLED by default (ADR-006 / Dossier §8)', () => {
  it('default output ignores the heuristic completely: eligible and ineligible inputs give identical states and text', () => {
    const likely = base({ income: { salary: 0, unemployment: 0 }, birthDate: '1990-01-01' });
    const unlikely = base({ income: { salary: 9000, unemployment: 0 }, birthDate: '1990-01-01', housing: { status: 'owner', rent: 650 } });
    const e = runLocalSimulation(likely).rights.map((r) => r.eligible), n = runLocalSimulation(unlikely).rights.map((r) => r.eligible);
    expect(e).not.toEqual(n);                                                          // the heuristic outcomes really differ
    const a = buildAssessment({ simulation: runLocalSimulation(likely), answers: likely }), b = buildAssessment({ simulation: runLocalSimulation(unlikely), answers: unlikely });
    expect(a.leadsEnabled).toBe(false);
    expect(a.items.map((i) => [i.code, i.state, i.explanation])).toEqual(b.items.map((i) => [i.code, i.state, i.explanation]));
    expect(a.items.every((i) => i.state === STATES.CHECK_REQUIRED)).toBe(true);
  });
  it('the heuristic is not even read when leads are off (a poisoned simulation object is harmless)', () => {
    const poison = { get rights() { throw new Error('heuristic must not be read'); } };
    expect(() => buildAssessment({ simulation: poison, answers: base() })).not.toThrow();
  });
  it('only an explicit true enables leads', () => {
    for (const v of [undefined, null, 0, '', 'true', 1, {}]) expect(buildAssessment({ simulation: runLocalSimulation(base()), answers: base(), leadsEnabled: v }).leadsEnabled).toBe(v === true);
  });
});

describe('N2/N8 — with leads on, a hit is only a lead and a miss is never "not applicable"', () => {
  it('heuristic eligible:true => POSSIBLE (lead); eligible:false => CHECK_REQUIRED; nothing else', () => {
    const states = new Set();
    for (const answers of GRID) for (const it of run(answers, true).items) if (it.state !== STATES.MISSING_INFORMATION) states.add(it.state);
    // DTA S2A (A6): UNSUPPORTED now also comes from a territory-bound right outside its declared scope; still never ELIGIBLE / NOT_APPLICABLE
    expect([...states].sort()).toEqual([STATES.CHECK_REQUIRED, STATES.POSSIBLE, STATES.UNSUPPORTED].sort());
  });
  it('a miss never carries "non applicable"-style wording', () => {
    const a = run(base({ income: { salary: 9000, unemployment: 0 } }), true);
    for (const it of a.items) expect(it.explanation + it.explanationFalc).not.toMatch(/non applicable|n'avez pas droit/i);
  });
  it('a postcode outside 67 never yields a POSSIBLE FAJ lead (N8); since S2A the territory is data and the item is UNSUPPORTED (D4 closed)', () => {
    for (const territory of ['75001', '68000', '13001']) {
      const faj = run(base({ birthDate: '2005-05-05', income: { salary: 100, unemployment: 0 }, territory }), true).items.find((i) => i.code === 'faj-strasbourg');
      expect(faj.state).toBe(STATES.UNSUPPORTED);
    }
  });
});

describe('MISSING_INFORMATION and UNSUPPORTED', () => {
  it('missing or "unknown" facts => MISSING_INFORMATION with the list, still no result about the right', () => {
    const a = buildAssessment({ answers: { birthDate: '1990-01-01', householdSize: 'unknown', income: {}, housing: { status: 'unknown' }, territory: '' }, leadsEnabled: true, simulation: { rights: [{ code: 'rsa', eligible: true, amount: 500 }] } });
    const by = Object.fromEntries(a.items.map((i) => [i.code, i]));
    expect(by.rsa.state).toBe(STATES.MISSING_INFORMATION);
    expect(by.rsa.missingFacts).toEqual(['householdSize', 'income']);
    expect(by.apl.missingFacts).toEqual(['housing.status', 'housing.rent']);
    expect(by['faj-strasbourg'].missingFacts).toEqual(['territory']);
    expect(by.rsa.amount).toBeNull();
  });
  it('rights without a verified rule are UNSUPPORTED (no claim, no amount); the list is supplied by the caller, not invented here', () => {
    const a = buildAssessment({ answers: base(), unsupportedRights: [{ code: 'are', label: 'ARE' }, { code: 'apa', label: 'APA', reason: 'aucune règle vérifiée' }] });
    expect(a.items.filter((i) => i.state === STATES.UNSUPPORTED).map((i) => i.code)).toEqual(['are', 'apa']);
    expect(buildAssessment({ answers: base() }).items.some((i) => i.state === STATES.UNSUPPORTED)).toBe(false);
  });
  it('ENGINE_UNAVAILABLE carries no fallback result', () => {
    const e = engineUnavailableAssessment();
    expect(e.items).toHaveLength(1);
    expect(e.items[0].state).toBe(STATES.ENGINE_UNAVAILABLE);
    expect(e.items.map((i) => i.code)).toEqual(['engine']);
    expect(JSON.stringify(e)).not.toMatch(/rsa|apl|faj/i);
  });
});

describe('N15 — five provenance fields on every item, explicit when absent', () => {
  it('present, never empty, honest negatives (no source, not verified)', () => {
    for (const a of [run(base(), false), run(base(), true), run({ birthDate: '1990-01-01' }, true), engineUnavailableAssessment()]) for (const it of a.items) {
      for (const f of PROVENANCE_FIELDS) { expect(it.provenance).toHaveProperty(f); expect(typeof it.provenance.display[f]).toBe('string'); expect(it.provenance.display[f].length).toBeGreaterThan(5); }
      expect(it.provenance.source).toBeNull();
      expect(it.provenance.verifiedAt).toBeNull();
      expect(it.provenance.display.verifiedAt).toMatch(/non vérifié/i);
      expect(it.provenance.display.source).toMatch(/aucune/i);
    }
    expect(NOT_AVAILABLE).toBe('NON_DISPONIBLE');
  });
  it('dataStatus can never claim verification unless the manifest verdict is exactly VERIFIED_CURRENT', () => {
    for (const s of [undefined, 'UNKNOWN', 'verified', true, 'launchReady', 'VERIFIED']) expect(buildAssessment({ answers: base(), dataStatus: s }).dataStatus).toBe('UNVERIFIED');
    expect(buildAssessment({ answers: base() }).dataStatus).toBe('UNVERIFIED');
  });
});

describe('validator rejects forbidden shapes (the invariants hold even if a caller builds items by hand)', () => {
  const ok = () => structuredClone(run(base(), false).items[0]);
  it('accepts a conforming item', () => expect(assertAssessmentItem(ok())).toBe(true));
  it('rejects authoritative states without full authority', () => {
    for (const state of AUTHORITATIVE_STATES) {
      expect(() => assertAssessmentItem({ ...ok(), state })).toThrow(/authoritative/);
      expect(() => assertAssessmentItem({ ...ok(), state, authoritative: true })).toThrow(/authoritative state without/);
    }
  });
  it('rejects an amount, a missing provenance field, an unknown state and forbidden wording', () => {
    expect(() => assertAssessmentItem({ ...ok(), amount: 123 })).toThrow(/amount/);
    const p = ok(); delete p.provenance.rule; expect(() => assertAssessmentItem(p)).toThrow(/provenance\.rule/);
    expect(() => assertAssessmentItem({ ...ok(), state: 'ELIGIBLE' })).toThrow(/unknown state/);
    for (const w of ['Vous êtes éligible', 'Vous avez droit à 500 €', 'Droit non applicable', 'selon les règles de calcul officielles']) expect(() => assertAssessmentItem({ ...ok(), explanation: w })).toThrow(/forbidden wording/);
  });
});

describe('wording and determinism', () => {
  it('no produced text states or implies a right', () => {
    const all = [run(base(), true), run(base(), false), run({ birthDate: '1990-01-01' }, true), engineUnavailableAssessment(), buildAssessment({ answers: base(), unsupportedRights: [{ code: 'x', label: 'X' }] })];
    for (const a of all) for (const it of a.items) for (const t of [it.explanation, it.explanationFalc]) expect(t).not.toMatch(/éligible|eligible|avez droit|non applicable|officielle|estim|€/i);
  });
  it('N13 deterministic and independent of the clock', () => {
    const a = JSON.stringify(run(base(), true));
    vi.useFakeTimers(); vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    const b = JSON.stringify(run(base(), true));
    vi.useRealTimers();
    expect(b).toBe(a);
  });
  it('module is pure: no imports, no clock, no randomness, no I/O, no env', () => {
    const src = readFileSync(new URL('../../api/lib/assessmentContract.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src.match(/^\s*import\s.*$/gm).map((l) => l.trim())).toEqual(["import { TERRITORY_SCOPES, territoryStatus } from './territoryScopes.js';", "import { ageFromBand } from './ageBands.js';"]);   // S2A/S2B: the ONLY imports are the two pure data modules (territory scopes, age bands)
    expect(src).not.toMatch(/Date\.now|new Date|Math\.random|fetch\(|process\.env|require\(|fs\.|crypto/);
  });
});
