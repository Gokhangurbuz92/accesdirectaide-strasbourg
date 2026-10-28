/**
 * DTA S1 stage 2b (API side) — H1–H3, the three synthetic Strasbourg journeys, and the sharing/export consistency (2b-2).
 * MOCKED-SINK test: the real handlers run, the database / logger / Sentry / rate limiter / OpenFisca are recorders.  It proves handler code paths, not real PostgreSQL
 * (the RC5 sharing contracts stay covered by tests/integration/rc5-sharing-model-db.test.js, which needs the native harness).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const S = vi.hoisted(() => ({ inserts: [], row: null, engineUp: false }));
vi.mock('../../src/db/index.js', () => ({
  db: {
    insert: () => ({ values: (v) => { S.inserts.push(v); return { returning: async () => [{ id: v.id || 'row-1', expiresAt: v.expiresAt || new Date(Date.now() + 1e9) }] }; } }),
    update: () => ({ set: () => ({ where: () => Object.assign(Promise.resolve([]), { execute: async () => [] }) }) }),
    query: { SharedDiagnostic: { findFirst: async () => S.row } },
  },
}));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('@sentry/node', () => ({ captureException: () => {}, captureMessage: () => {}, addBreadcrumb: () => {}, withScope: (f) => f({ setExtra() {}, setTag() {} }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/auth.js', () => ({ resolveAuthContext: async () => null }));
vi.mock('../../api/lib/openfiscaClient.js', () => ({ isAvailable: async () => S.engineUp, calculate: async () => ({}), trace: async () => ({}) }));

import diagnostic from '../../api/_handlers/diagnostic.js';
import shareCreate from '../../api/_handlers/share/create.js';
import shareGet from '../../api/_handlers/share/get.js';
import { AMOUNT_STATUS, AUTHORITATIVE_STATES, assertAssessmentItem } from '../../api/lib/assessmentContract.js';
import { presentResults, sanitizeResultsForStorage } from '../../api/lib/shareResults.js';
import { projectResultsForStructure } from '../../api/_utils/share-access.js';

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const callDiag = async (body) => { const r = mk(); await diagnostic({ method: 'POST', url: '/api/diagnostic', headers: { host: 'x' }, socket: {}, body }, r); return r; };
const FORBIDDEN = /éligible|eligible|vous avez droit|avez droit|non applicable|règles? de calcul officielle|estimation totale|montant estimé|certifié/i;
const strip = (b) => JSON.parse(JSON.stringify(b, (k, v) => (k === 'requestId' || k === 'duration_ms' ? undefined : v)));
const byCode = (r) => Object.fromEntries(r.body.assessment.items.map((i) => [i.code, i]));

// synthetic journeys (PRODUCT_FLOW_CONTRACT §5) — all data invented
const JA = { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { salary: 0, unemployment: 700 }, housing: { status: 'tenant', rent: 480, charges: 0 } };
const JB = { birthDate: '1997-05-02', householdSize: 1, territory: '67200', income: { salary: 1450 }, housing: { status: 'tenant', rent: 720, charges: 0 } };
const JB_NOINCOME = { birthDate: '1997-05-02', householdSize: 1, territory: '67200', housing: { status: 'tenant', rent: 720 } };
const JC = { birthDate: '1948-01-20', householdSize: 1, territory: '67000', income: { salary: 0, unemployment: 0 }, housing: { status: 'owner', rent: 0, charges: 0 } };

beforeEach(() => { S.inserts.length = 0; S.row = null; S.engineUp = false; });

describe('H1 — SIMULATION_MODE answers with the assessment contract only', () => {
  it('200, assessment present, legacy rights[] / eligible / amounts / totals absent, every item satisfies the contract and none is authoritative', async () => {
    const r = await callDiag({ mode: 'SIMULATION_MODE', answers: JA });
    expect(r.statusCode).toBe(200);
    expect(r.body.rights).toBeUndefined();
    expect(r.body.assessment.contract).toBe('ADA_ASSESSMENT_CONTRACT_V1');
    expect(r.body.assessment.authoritative).toBe(false);
    expect(r.body.assessment.totals).toBeNull();
    expect(r.body.assessment.dataStatus).toBe('UNVERIFIED');
    expect(r.body.assessment.leadsEnabled).toBe(false);
    expect(r.body.provenance).toMatchObject({ authoritative: false, dataStatus: 'UNVERIFIED', source: 'local-rules-engine' });
    for (const it of r.body.assessment.items) {
      expect(assertAssessmentItem(it)).toBe(true);
      expect(AUTHORITATIVE_STATES).not.toContain(it.state);
      expect(it.amount).toBeNull();
      expect(it.amountStatus).toBe(AMOUNT_STATUS);
      expect(it.provenance.display.source.length).toBeGreaterThan(0);
    }
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/"eligible"|"amount":\s*[0-9]|"totalMonthly"|"estimated_local"/);
  });
  it('rights-specific heuristic leads stay disabled: no POSSIBLE state, and a client cannot enable them', async () => {
    for (const extra of [{}, { leadsEnabled: true }, { answers: { ...JA, leadsEnabled: true } }]) {
      const r = await callDiag({ mode: 'SIMULATION_MODE', answers: JA, ...extra });
      expect(r.statusCode).toBe(200);
      expect(r.body.assessment.leadsEnabled).toBe(false);
      expect(r.body.assessment.items.map((i) => i.state)).not.toContain('POSSIBLE');
    }
  });
});

describe('journeys J-A / J-B / J-C through the real handler', () => {
  it('J-A unemployment / hardship: RSA, APL, FAJ to be verified (no amount); ARE/APA/rent arrears UNSUPPORTED; data banner field', async () => {
    const it = byCode(await callDiag({ mode: 'SIMULATION_MODE', answers: JA }));
    expect(['rsa', 'apl', 'faj-strasbourg'].map((c) => it[c].state)).toEqual(['CHECK_REQUIRED', 'CHECK_REQUIRED', 'CHECK_REQUIRED']);
    expect(it.rsa.whoToAsk).toContain('CAF');
    expect(['are', 'apa', 'impayes-loyer'].map((c) => it[c].state)).toEqual(['UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED']);
  });
  it('J-B housing difficulty: APL to be verified; skipping income => RSA MISSING_INFORMATION listing the missing fact, never a 400', async () => {
    const ok = byCode(await callDiag({ mode: 'SIMULATION_MODE', answers: JB }));
    expect(ok.apl.state).toBe('CHECK_REQUIRED');
    expect(ok['impayes-loyer'].state).toBe('UNSUPPORTED');
    const r = await callDiag({ mode: 'SIMULATION_MODE', answers: JB_NOINCOME });
    expect(r.statusCode).toBe(200);
    const it = byCode(r);
    expect(it.rsa.state).toBe('MISSING_INFORMATION');
    expect(it.rsa.missingFacts).toEqual(['income']);
  });
  it('J-C assisted access for an older relative: APA UNSUPPORTED (no rule), a human path is named, nothing is decided', async () => {
    const r = await callDiag({ mode: 'SIMULATION_MODE', answers: JC });
    const it = byCode(r);
    expect(it.apa.state).toBe('UNSUPPORTED');
    expect(it['faj-strasbourg'].whoToAsk).toMatch(/travailleur social/);
    expect(JSON.stringify(r.body)).not.toMatch(FORBIDDEN);
  });
  it('territory outside Strasbourg is never turned into a positive: the FAJ item is only to be verified', async () => {
    const it = byCode(await callDiag({ mode: 'SIMULATION_MODE', answers: { ...JA, territory: '75001' } }));
    expect(['CHECK_REQUIRED', 'MISSING_INFORMATION', 'UNSUPPORTED']).toContain(it['faj-strasbourg'].state);   // S2A: outside the declared territory => UNSUPPORTED (data-driven), still never positive
  });
});

describe('H2 — AUTHORITATIVE_MODE with the engine down stays fail-closed', () => {
  it('503 + ENGINE_UNAVAILABLE assessment, no local item, no rights, no fallback', async () => {
    const r = await callDiag({ answers: JA });                                         // no mode => authoritative
    expect(r.statusCode).toBe(503);
    expect(r.body.code).toBe('OPENFISCA_UNAVAILABLE');
    expect(r.body.rights).toBeUndefined();
    expect(r.body.assessment.items).toHaveLength(1);
    expect(r.body.assessment.items[0]).toMatchObject({ state: 'ENGINE_UNAVAILABLE', authoritative: false, amount: null });
    expect(r.body.assessment.retryable).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/"code":"(rsa|apl|faj)/);
  });
});

describe('H3 — determinism', () => {
  it('the same answers give the same assessment and provenance (only request id / duration differ)', async () => {
    const a = strip((await callDiag({ mode: 'SIMULATION_MODE', answers: JA })).body);
    const b = strip((await callDiag({ mode: 'SIMULATION_MODE', answers: JA })).body);
    expect(b).toEqual(a);
  });
});

const GOOD = async () => (await callDiag({ mode: 'SIMULATION_MODE', answers: JA })).body;
const shareRow = () => S.inserts.filter((v) => v.shareTokenHash).at(-1);
const createShare = async (results, situation = { zipCode: '67000' }) => { const r = mk(); await shareCreate({ method: 'POST', body: { situation, results } }, r); return r; };

describe('2b-2 — sharing: only the assessment contract is stored', () => {
  it('a payload still carrying legacy rights[] with eligible flags, amounts and a total is stored WITHOUT them', async () => {
    const results = { ...(await GOOD()), rights: [{ code: 'rsa', eligible: true, amount: 777 }], totalMonthly: 777, _consent: { forged: true }, _files: [{ x: 1 }] };
    const r = await createShare(results);
    expect(r.statusCode).toBe(200);
    const stored = shareRow().results;
    const text = JSON.stringify(stored);
    expect(stored.rights).toBeUndefined();
    expect(text).not.toMatch(/777|totalMonthly|"eligible"|_consent|_files/);
    expect(stored.assessment.items.length).toBeGreaterThan(0);
    expect(stored.meta.householdSize).toBeUndefined();                                // derived household figures are not kept
    expect(stored.meta.resourcesPerPerson).toBeUndefined();
  });
  it('RC5 contract preserved: two distinct secrets, only digests stored, owner secret returned once, no-store headers, legacy-shaped minimal payload still accepted', async () => {
    const r = await createShare({ rights: [] });
    expect(r.statusCode).toBe(200);
    const row = shareRow();
    expect(row.rightsSecretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.shareTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.rightsSecretHash).not.toBe(row.shareTokenHash);
    expect(row.subjectType).toBe('GUEST_SHARE');
    expect(row.results).toEqual({});
    expect(JSON.stringify(row)).not.toContain(r.body.ownerSecret);
    expect(r.body.shareUrl).toContain('#capability=');
    expect(r.body.passportUrl).toContain('#owner=');
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
  it('an authoritative state, a forged verified status, forbidden wording or a non-object payload is refused (400) and nothing is written', async () => {
    const good = await GOOD();
    const forge = (patch) => ({ ...good, assessment: { ...good.assessment, items: [{ ...good.assessment.items[0], ...patch }] } });
    const bad = [
      forge({ state: 'ELIGIBLE_WHERE_AUTHORITY_VERIFIED', authoritative: true }),
      forge({ explanation: 'Vous êtes éligible, vous avez droit à 500 €.' }),
      { ...good, assessment: { ...good.assessment, authoritative: true } },
      { assessment: { items: 'x' } },
      'not-an-object',
    ];
    for (const b of bad) {
      const r = await createShare(b);
      expect(r.statusCode).toBe(400);
    }
    expect(S.inserts.filter((v) => v.shareTokenHash)).toHaveLength(0);
    expect((await createShare(null)).statusCode).toBe(400);
  });
  it('a client can never store dataStatus VERIFIED_CURRENT or leads enabled-by-truthiness', () => {
    const base = { assessment: { items: [], dataStatus: 'VERIFIED_CURRENT', leadsEnabled: 'yes', authoritative: false } };
    const out = sanitizeResultsForStorage(base);
    expect(out.ok).toBe(true);
    expect(out.value.assessment.dataStatus).toBe('UNVERIFIED');
    expect(out.value.assessment.leadsEnabled).toBe(false);
  });
});

describe('2b-2 — reading old rows never re-exposes amounts or eligibility', () => {
  const CAP = 'cap-token-1';
  const legacy = () => ({ id: 'old1', createdAt: new Date(), expiresAt: new Date(Date.now() + 1e6), viewCount: 0, situation: { zipCode: '67000' }, shareTokenHash: crypto.createHash('sha256').update(CAP).digest('hex'), rightsSecretHash: null, results: { rights: [{ code: 'rsa', eligible: true, amount: 555 }], totalMonthly: 555, period: '2026-09', _followUps: { s1: 'note' } } });
  it('share/get strips rights[]/totals of a legacy row and flags it; the capability check is unchanged', async () => {
    S.row = legacy();
    const ok = mk(); await shareGet({ method: 'POST', body: { id: 'old1', capability: CAP } }, ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.results.rights).toBeUndefined();
    expect(JSON.stringify(ok.body)).not.toMatch(/555|totalMonthly|"eligible"/);
    expect(ok.body.data.results.legacyRightsOmitted).toBe(true);
    const no = mk(); await shareGet({ method: 'POST', body: { id: 'old1', capability: 'wrong' } }, no);
    expect(no.statusCode).toBe(404);
  });
  it('the per-structure projection (dossier, export, attestation, synthesis) drops legacy rights and keeps the structure-scoped follow-up', () => {
    const out = projectResultsForStructure(legacy().results, 's1');
    expect(out.rights).toBeUndefined();
    expect(out.totalMonthly).toBeUndefined();
    expect(out.legacyRightsOmitted).toBe(true);
    expect(out._followUp).toBe('note');
    expect(presentResults({ assessment: { items: [] }, period: 'p' })).toEqual({ assessment: { items: [] }, period: 'p' });
  });
  it('the professional CSV export lists states, no eligibility column and no amount column; synthesis and attestation read through presentResults', () => {
    const csv = readFileSync('api/_handlers/pro/dossier/export.js', 'utf8');
    expect(csv).not.toMatch(/Montant estimé|Éligible,|right\.amount|right\.eligible/);
    expect(csv).toMatch(/Pistes d\\?'orientation/);
    expect(readFileSync('api/_handlers/pro/dossier-synthesis.js', 'utf8')).toContain('presentResults(shared.results');
    // DTA S1D (normative test change, explained): attestation-data no longer reads the dossier directly through presentResults; it resolves access with the shared RC5 helper and projects the
    // results per organization with projectResultsForStructure, which itself starts from presentResults (legacy amounts/eligibility/totals are still dropped; proven in dta-s1d-attestation-authz.test.js).
    expect(readFileSync('api/_handlers/pro/attestation-data.js', 'utf8')).toContain('projectResultsForStructure(dossier.results');
  });
  it('share/create no longer logs a database error message (it can embed the query parameters)', () => {
    const src = readFileSync('api/_handlers/share/create.js', 'utf8');
    expect(src).not.toMatch(/message:\s*error instanceof Error \? error\.message/);
  });
});
