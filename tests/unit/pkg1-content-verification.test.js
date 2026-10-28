// PKG-1 / D-5 — the verification service: human-only authority, evidence preconditions, ledger + projection in one transaction, and "nobody else writes the verification columns".
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, evidenceUrlAllowed, recordVerification } from '../../api/_services/content-verification.js';

const NOW = new Date('2026-10-18T12:00:00Z');
const reviewer = { id: 'admin-7', role: 'admin' };
const NOTE = 'Checked on service-public.fr: amount and conditions match the fiche.';

/** Minimal chainable fake of the drizzle surface the service uses; records every write. */
function fakeDb(row) {
  const writes = { updates: [], inserts: [] };
  const state = { row };
  const tx = {
    select: () => ({ from: () => ({ where: () => { const rows = state.row ? [state.row] : []; const p = Promise.resolve(rows); p.for = () => Promise.resolve(rows); return p; } }) }),
    update: () => ({ set: (patch) => ({ where: async () => { writes.updates.push(patch); state.row = { ...state.row, ...patch }; } }) }),
    insert: () => ({ values: async (v) => { writes.inserts.push(v); } }),
  };
  return { writes, db: { transaction: async (fn) => fn(tx) } };
}
const baseRow = (o = {}) => ({ id: 'a1', statut: 'publie', launch_eligible: false, verification_status: 'UNVERIFIED', verified_by: null, territory_verified: false, publication_hold: null, data_origin: 'unclassified', date_verification: null, source_url: 'https://www.service-public.fr/x', source_url_exact: null, ...o });
const verify = (extra = {}) => ({ entityType: 'aide', entityId: 'a1', action: 'VERIFY', reviewer, sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1', evidenceNote: NOTE, territoryConfirmed: true, ...extra });

describe('evidenceUrlAllowed', () => {
  it('accepts https hosts on the official allow-list and their subdomains', () => {
    expect(evidenceUrlAllowed('https://www.service-public.fr/a')).toBe(true);
    expect(evidenceUrlAllowed('https://www.caf.fr/x')).toBe(true);
  });
  it('rejects http, look-alike hosts, substring tricks and garbage', () => {
    for (const u of ['http://www.service-public.fr/a', 'https://service-public.fr.evil.example/a', 'https://evil.example/?u=https://www.caf.fr', 'https://evil.example/service-public.fr', 'not a url', '', null]) expect(evidenceUrlAllowed(u), String(u)).toBe(false);
  });
  it('honours the owner-extended list by exact host or subdomain only', () => {
    const env = { ADA_VERIFICATION_EXTRA_DOMAINS: 'strasbourg.eu, example.org' };
    expect(evidenceUrlAllowed('https://www.strasbourg.eu/p', env)).toBe(true);
    expect(evidenceUrlAllowed('https://strasbourg.eu.evil.com/p', env)).toBe(false);
    expect(evidenceUrlAllowed('https://notstrasbourg.eu/p', env)).toBe(false);
  });
});

describe('recordVerification preconditions', () => {
  it('knows exactly four actions', () => { expect(ACTIONS).toEqual(['VERIFY', 'REJECT', 'HOLD', 'RELEASE_HOLD']); });
  it.each([
    ['unknown entity type', verify({ entityType: 'user' }), 400, 'UNKNOWN_ENTITY_TYPE'],
    ['unknown action', verify({ action: 'APPROVE' }), 400, 'UNKNOWN_ACTION'],
    ['no entity id', verify({ entityId: '' }), 400, 'ENTITY_ID_REQUIRED'],
    ['no identified reviewer', verify({ reviewer: {} }), 403, 'NO_HUMAN_REVIEWER'],
    ['short evidence note', verify({ evidenceNote: 'ok' }), 400, 'EVIDENCE_NOTE_REQUIRED'],
    ['territory not confirmed', verify({ territoryConfirmed: false }), 400, 'TERRITORY_CONFIRMATION_REQUIRED'],
    ['evidence off the allow-list', verify({ sourceUrl: 'https://evil.example/x' }), 400, 'EVIDENCE_URL_NOT_ALLOWED'],
    ['hold without a reason', { ...verify(), action: 'HOLD', holdReason: 'x' }, 400, 'HOLD_REASON_REQUIRED'],
    ['reject without a reason', { ...verify(), action: 'REJECT', evidenceNote: '' }, 400, 'EVIDENCE_NOTE_REQUIRED'],
  ])('%s is refused before any database access', async (_n, input, status, code) => {
    const { db, writes } = fakeDb(baseRow());
    const r = await recordVerification(input, { db, now: NOW, env: {} });
    expect(r).toMatchObject({ ok: false, status, code });
    expect(writes.updates).toHaveLength(0);
    expect(writes.inserts).toHaveLength(0);
  });
});

describe('recordVerification outcomes', () => {
  it('VERIFY projects server-clock verification onto the row and appends exactly one ledger row', async () => {
    const { db, writes } = fakeDb(baseRow());
    const r = await recordVerification(verify(), { db, now: NOW, env: {} });
    expect(r.ok).toBe(true);
    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]).toMatchObject({ verification_status: 'VERIFIED', verified_by: 'admin-7', date_verification: NOW, territory_verified: true, launch_eligible: true, data_origin: 'official' });
    // owner LAB audit: exactly one ledger row (with the content version decided on) and the same decision in the administration journal
    const ledger = writes.inserts.filter((x) => 'outcome' in x);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ entityType: 'aide', entityId: 'a1', outcome: 'VERIFIED', reviewerId: 'admin-7', verifiedAt: NOW });
    expect(ledger[0].contentVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(writes.inserts.filter((x) => x.action === 'CONTENT_VERIFIED')).toHaveLength(1);
    // the existing provenance is kept (the reviewer's URL only fills a gap)
    expect(writes.updates[0].source_url).toBeUndefined();
  });
  it('a record with no provenance gets the reviewer-supplied official URL, and the decision reflects visibility', async () => {
    const { db, writes } = fakeDb(baseRow({ source_url: null }));
    const r = await recordVerification(verify(), { db, now: NOW, env: {} });
    expect(writes.updates[0].source_url).toBe('https://www.service-public.fr/particuliers/vosdroits/F1');
    expect(r.decision.visible).toBe(true);
  });
  it('the client cannot choose the verification time', async () => {
    const { db, writes } = fakeDb(baseRow());
    await recordVerification({ ...verify(), verifiedAt: '2001-01-01', date_verification: '2001-01-01' }, { db, now: NOW, env: {} });
    expect(writes.updates[0].date_verification).toBe(NOW);
  });
  it('VERIFY is refused while a hold is active, and for synthetic fixtures', async () => {
    let f = fakeDb(baseRow({ publication_hold: 'PRIVACY_REVIEW' }));
    expect(await recordVerification(verify(), { db: f.db, now: NOW, env: {} })).toMatchObject({ ok: false, status: 409, code: 'PUBLICATION_HOLD_ACTIVE' });
    f = fakeDb(baseRow({ data_origin: 'synthetic_fixture' }));
    expect(await recordVerification(verify(), { db: f.db, now: NOW, env: {} })).toMatchObject({ ok: false, status: 409, code: 'SYNTHETIC_CANNOT_BE_VERIFIED' });
    expect(f.writes.inserts).toHaveLength(0);
  });
  it('unknown record is a 404 with no writes', async () => {
    const { db, writes } = fakeDb(null);
    expect(await recordVerification(verify(), { db, now: NOW, env: {} })).toMatchObject({ ok: false, status: 404 });
    expect(writes.inserts).toHaveLength(0);
  });
  it('REJECT removes eligibility; HOLD hides a verified record; RELEASE_HOLD restores only the hold', async () => {
    const verified = baseRow({ launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'admin-1', territory_verified: true, data_origin: 'official', date_verification: new Date(NOW.getTime() - 86400000) });
    let f = fakeDb(verified);
    expect((await recordVerification({ ...verify(), action: 'REJECT', evidenceNote: 'Amount outdated' }, { db: f.db, now: NOW, env: {} })).decision.visible).toBe(false);
    f = fakeDb(verified);
    const held = await recordVerification({ ...verify(), action: 'HOLD', holdReason: 'PRIVACY_REVIEW: phone is personal' }, { db: f.db, now: NOW, env: {} });
    expect(held.decision.reasons).toContain('PUBLICATION_HOLD');
    expect(f.writes.updates[0]).toEqual({ publication_hold: 'PRIVACY_REVIEW: phone is personal' });
    const released = await recordVerification({ ...verify(), action: 'RELEASE_HOLD' }, { db: f.db, now: NOW, env: {} });
    expect(f.writes.updates[1]).toEqual({ publication_hold: null });
    expect(released.decision.visible).toBe(true);
  });
});

describe('single writer of the verification columns (static scan)', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const WRITERS = new Set(['api/_services/content-verification.js']);
  const COLS = /(launch_eligible|verification_status|verified_by|territory_verified|publication_hold)\s*:/;
  const walk = (dir, out = []) => {
    for (const n of readdirSync(join(root, dir))) {
      const rel = join(dir, n);
      const st = statSync(join(root, rel));
      if (st.isDirectory()) walk(rel, out); else if (/\.(js|mjs|ts)$/.test(n)) out.push(rel);
    }
    return out;
  };
  it('no other api/ or scripts/ file assigns the verification columns', () => {
    const offenders = [];
    for (const f of [...walk('api'), ...walk('scripts')]) {
      if (WRITERS.has(f)) continue;
      const s = readFileSync(join(root, f), 'utf8');
      if (!COLS.test(s)) continue;
      // reads in WHERE clauses / select lists use eq(...) or destructuring, never `column:` object-literal writes: allow the visibility module, the seed (which returns undefined to drop them) and read-only selects.
      if (/\.(set|values)\(\s*\{[^}]*(launch_eligible|verification_status|verified_by|territory_verified|publication_hold)\s*:/s.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  it('the seed refuses to copy the five human-owned columns from data files', () => {
    const s = readFileSync(join(root, 'scripts/seed-strasbourg.mjs'), 'utf8');
    for (const c of ['launcheligible', 'verificationstatus', 'verifiedby', 'territoryverified', 'publicationhold']) expect(s).toContain(`'${c}'`);
    expect(s).toMatch(/if \(VERIFICATION_OWNED_COLUMNS\.has\(normalizeKey\(columnName\)\)\) return undefined;/);
    expect(s).toMatch(/VERIFICATION_OWNED_COLUMNS/);
  });
  it('the ledger is protected by a database trigger (migration 0015)', () => {
    const sql = readFileSync(join(root, 'drizzle/0015_pkg1_public_visibility_account_core.sql'), 'utf8');
    expect(sql).toMatch(/ContentVerification_no_update_delete/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE/);
  });
});
