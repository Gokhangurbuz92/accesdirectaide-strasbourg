/**
 * DTA S1D — GET /api/pro/attestation-data authorization (native run 20261017T234555Z-9b18da: an organization WITHOUT a grant received HTTP 200 + dossier results).
 * Contract (RC5 X3 + owner decision): no grant / revoked grant / wrong organization / inactive membership / unknown dossier => uniform 404 (identical body);
 * a previously authorized organization on an EXPIRED dossier => 410; anonymous => 401; valid active grant => 200 with ONLY its own follow-up, never another organization's `_followUps`,
 * never `_files` / `_consent`, never legacy amounts; every successful attestation is audited (no payload in the audit record).
 * MOCKED-sink test of the handler code path (the shared helper is mocked here; the real-PostgreSQL proof is tests/integration/dta-attestation-authz-db.test.js).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const S = vi.hoisted(() => ({ resolve: null, audit: [], ctx: { userId: 'u1', structureId: 'S1' }, anonymous: false, resolveCalls: [] }));
vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('../../api/_utils/auth.js', () => ({
  requireProAuth: (h) => async (req, res) => (S.anonymous ? res.status(401).json({ error: 'Unauthorized' }) : h(req, res)),
  requireProStructureContext: () => S.ctx,
  logProAudit: async (...a) => { S.audit.push(a); },
}));
vi.mock('../../api/_utils/share-access.js', async (orig) => {
  const actual = await orig();
  return { ...actual, resolveDossierForStructure: async (id, ctx) => { S.resolveCalls.push([id, ctx]); return S.resolve(id, ctx); } };
});

import handler from '../../api/_handlers/pro/attestation-data.js';

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
const call = async (url = '/api/pro/attestation-data?shareId=sd1', method = 'GET') => { const r = mk(); await handler({ method, url, headers: { host: 'x', 'x-forwarded-for': '203.0.113.5' }, user: { email: 'agent@example.test', role: 'PRO' } }, r); return r; };
const CREATED = new Date('2026-10-01T10:00:00.000Z');
const shared = (results) => ({ id: 'sd1', createdAt: CREATED, expiresAt: new Date(Date.now() + 86400000), results });
const RESULTS = {
  assessment: { items: [{ code: 'rsa', state: 'CHECK_REQUIRED' }] }, period: '2026-09',
  _followUps: { S1: { internalNote: 'note-of-S1', status: 'a' }, S2: { internalNote: 'note-of-S2-SECRET', status: 'b' } },
  _followUp: 'legacy-shared-note', _files: [{ id: 'f1', structureId: 'S2' }], _consent: { sig: 'x' },
  rights: [{ code: 'rsa', eligible: true, amount: 98765.4321 }], totalMonthly: 98765.4321,
};
const NOT_FOUND = { status: 'not_found' };

beforeEach(() => { S.audit.length = 0; S.resolveCalls.length = 0; S.anonymous = false; S.ctx = { userId: 'u1', structureId: 'S1' }; S.resolve = async () => ({ status: 'ok', shared: shared(RESULTS), grant: { purposes: 'PURP-06' } }); });

describe('authorized organization (valid active grant)', () => {
  it('200, the response shape and certification fields are unchanged', async () => {
    const r = await call();
    expect(r.statusCode).toBe(200);
    const a = r.body.attestation;
    const certHash = crypto.createHash('sha256').update(`sd1:${CREATED.toISOString()}`).digest('hex').slice(0, 12).toUpperCase();
    expect(r.body.ok).toBe(true);
    expect(a).toMatchObject({ reference: `ADA-${certHash}`, certHash, usagerToken: 'SD1', professional: { name: 'agent', role: 'PRO', structure: 'S1' } });
    // G overlay v1: no verification portal exists, so no verifyUrl; the response says it is unsigned and fingerprints exactly the content returned
    expect(a.verifyUrl).toBeUndefined(); expect(a).toMatchObject({ kind: 'RECAP_NON_SIGNE', signed: false }); expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.results.assessment.items[0].code).toBe('rsa');
  });
  it('the access is decided by the SHARED helper with the caller\'s organization context', async () => {
    await call();
    expect(S.resolveCalls).toEqual([['sd1', { userId: 'u1', structureId: 'S1' }]]);
  });
  it('only the caller organization\'s own follow-up is returned; other organizations\' notes, the legacy shared note, files and consent never are', async () => {
    const r = await call(); const text = JSON.stringify(r.body);
    expect(r.body.attestation.results._followUp).toEqual({ internalNote: 'note-of-S1', status: 'a' });
    expect(r.body.attestation.results._followUps).toBeUndefined();
    expect(text).not.toContain('note-of-S2-SECRET'); expect(text).not.toContain('legacy-shared-note');
    expect(r.body.attestation.results._files).toBeUndefined(); expect(r.body.attestation.results._consent).toBeUndefined();
    expect(text).not.toMatch(/"f1"|"sig"/);
  });
  it('legacy eligibility flags, amounts and totals never leave', async () => {
    const r = await call(); const text = JSON.stringify(r.body);
    expect(text).not.toContain('98765'); expect(text).not.toMatch(/"eligible"|"totalMonthly"|"rights"/);
    expect(r.body.attestation.results.legacyRightsOmitted).toBe(true);
  });
  it('the successful attestation is audited with identifiers only (no results, notes or amounts in the record)', async () => {
    await call();
    expect(S.audit).toHaveLength(1);
    const [action, userId, structureId, details, ip] = S.audit[0];
    expect([action, userId, structureId]).toEqual(['ATTESTATION_VIEWED', 'u1', 'S1']);
    expect(details).toEqual({ shareId: 'sd1' });
    expect(ip).toBe('203.0.113.5');
    expect(JSON.stringify(S.audit)).not.toMatch(/note-of|98765|results/);
  });
});

describe('denied access is uniform and returns nothing', () => {
  const body404 = { error: 'Dossier introuvable.' };
  it.each([['unknown dossier / no grant / revoked grant / wrong organization / inactive member (all resolve to not_found)']])('%s => 404 with ONE identical body, no data, no audit', async () => {
    S.resolve = async () => NOT_FOUND;
    const r = await call();
    expect(r.statusCode).toBe(404); expect(r.body).toEqual(body404);
    expect(JSON.stringify(r.body)).not.toMatch(/results|attestation|certHash|usagerToken|structure/i);
    expect(S.audit).toHaveLength(0);
  });
  it('the 404 body is byte-identical to the one of the other dossier surfaces (export), so the surfaces cannot be told apart', () => {
    expect(readFileSync('api/_handlers/pro/dossier/export.js', 'utf8')).toContain("{ error: 'Dossier introuvable.' }");
    expect(readFileSync('api/_handlers/pro/attestation-data.js', 'utf8')).toContain("{ error: 'Dossier introuvable.' }");
  });
  it('a previously authorized organization on an EXPIRED dossier => 410 (the established RC5 contract), no data, no audit', async () => {
    S.resolve = async () => ({ status: 'expired', shared: shared(RESULTS), grant: {} });
    const r = await call();
    expect(r.statusCode).toBe(410); expect(r.body).toEqual({ error: 'Ce dossier a expiré.' });
    expect(JSON.stringify(r.body)).not.toContain('note-of'); expect(S.audit).toHaveLength(0);
  });
  it('anonymous => 401 before any dossier lookup', async () => {
    S.anonymous = true; const r = await call();
    expect(r.statusCode).toBe(401); expect(S.resolveCalls).toHaveLength(0); expect(S.audit).toHaveLength(0);
  });
  it('missing shareId => 400 and no lookup; wrong method => 405 and no lookup', async () => {
    expect((await call('/api/pro/attestation-data')).statusCode).toBe(400);
    expect((await call('/api/pro/attestation-data?shareId=sd1', 'POST')).statusCode).toBe(405);
    expect(S.resolveCalls).toHaveLength(0);
  });
  it('the handler fails closed (500, no data) if the authorization lookup throws', async () => {
    S.resolve = async () => { throw new Error('db down: SELECT secret'); };
    const r = await call();
    expect(r.statusCode).toBe(500); expect(JSON.stringify(r.body)).not.toMatch(/SELECT|secret|results/i); expect(S.audit).toHaveLength(0);
  });
});

describe('source guard: attestation-data uses the shared RC5 authorization and projection, never a raw dossier read', () => {
  const src = readFileSync('api/_handlers/pro/attestation-data.js', 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  it('resolveDossierForStructure + projectResultsForStructure + audit; no direct SharedDiagnostic query', () => {
    expect(src).toContain('resolveDossierForStructure'); expect(src).toContain('projectResultsForStructure'); expect(src).toContain('ATTESTATION_VIEWED');
    expect(src).not.toMatch(/db\.query\.SharedDiagnostic|from '..\/..\/..\/src\/db\/index\.js'|findFirst/);
  });
});
