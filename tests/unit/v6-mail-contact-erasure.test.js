/**
 * Legal v6 / owner decision C6 (17/11/2026) — the recipient's Mailjet contact (api/_services/mail-contact-erasure.js; Mailjet « GDPR Delete contacts »:
 * GET /v3/REST/contact/{email} then DELETE /v4/contacts/{contact_ID}) is deleted BEFORE the account leaves the database; a failure is never reported as a
 * deletion, never kept as an address (no KV retry list any more), and is retried only while the address is still in the account row, for a bounded window
 * (api/_services/privacy.js mailContactRetryWindow). Past the window the account is erased anyway and the failure recorded address-free, « intervention
 * humaine requise » (api/_services/mail-contact-failures.js). The HTTP layer is a mock: any host but api.mailjet.com throws, nothing leaves the machine.
 * The full flow on a real database: tests/integration/v6-mail-contact-erasure-db.test.js.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailContactEraser, MAIL_CONTACT_PENDING_KEY } from '../../api/_services/mail-contact-erasure.js';
import { createPrivacyRightsService, mailContactRetryWindow, MAIL_CONTACT_RETRY_WINDOW_DAYS, MAIL_CONTACT_DEADLINE_MARGIN_DAYS } from '../../api/_services/privacy.js';
import { recordMailContactFailure, resolveMailContactFailure, MAIL_CONTACT_FAILED } from '../../api/_services/mail-contact-failures.js';

const ADDRESS = 'v6-erased.person+tag@example.test';
const MAILJET = () => ({ provider: 'mailjet', apiKey: 'pub_test:sec_test' });
const BASIC = `Basic ${Buffer.from('pub_test:sec_test').toString('base64')}`;
const DAY = 86400000;

/** @param {(call: { method: string, path: string }) => { status: number, body?: unknown } | 'throw'} answer */
function fakeFetch(answer) {
  /** @type {Array<{ method: string, path: string, auth: string }>} */ const calls = [];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    const u = new URL(String(url));
    if (u.hostname !== 'api.mailjet.com') throw new Error(`unexpected host ${u.hostname}`);
    const call = { method: String(init.method), path: u.pathname, auth: String(init.headers.Authorization) };
    calls.push(call);
    const a = answer(call);
    if (a === 'throw') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl, calls };
}
function fakeKv() {
  /** @type {Map<string, string[]>} */ const lists = new Map();
  return { lists,
    async lpush(/** @type {string} */ k, /** @type {string} */ v) { const l = lists.get(k) || []; l.unshift(v); lists.set(k, l); return l.length; },
    async lrange(/** @type {string} */ k) { return [...(lists.get(k) || [])]; },
    async ltrim() { return 'OK'; },
    async del(/** @type {string} */ k) { return lists.delete(k) ? 1 : 0; } };
}
function fakeLogger() {
  /** @type {unknown[][]} */ const lines = [];
  const push = (/** @type {unknown[]} */ ...a) => { lines.push(a); };
  return { lines, info: push, warn: push, error: push };
}
const eraser = (/** @type {any} */ o) => createMailContactEraser({ sleep: async () => {}, config: MAILJET, ...o });
const FOUND = { status: 200, body: { Count: 1, Data: [{ ID: 12345678, Email: ADDRESS }], Total: 1 } };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Mailjet contact erasure — the documented two calls', () => {
  it('success: looks the contact up by address, then deletes it by id on the v4 endpoint, with the Send API credentials', async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.method === 'GET' ? FOUND : { status: 200, body: { Count: 1 } }));
    const log = fakeLogger(); const kv = fakeKv();
    const out = await eraser({ fetchImpl, kv, logger: log }).erase(ADDRESS, { reason: 'account_erasure' });
    expect(out).toEqual({ outcome: 'deleted', status: 200 });
    expect(calls).toEqual([
      { method: 'GET', path: `/v3/REST/contact/${encodeURIComponent(ADDRESS)}`, auth: BASIC },
      { method: 'DELETE', path: '/v4/contacts/12345678', auth: BASIC },
    ]);
    expect(JSON.stringify(log.lines)).not.toMatch(/example\.test|12345678/);
    expect(kv.lists.size).toBe(0);
  });

  it('the official guide is cited in the code', () => {
    const src = readFileSync('api/_services/mail-contact-erasure.js', 'utf8');
    expect(src).toContain('https://dev.mailjet.com/docs/email-api/contact-management/gdpr-delete-contacts');
    expect(src).toContain('/v4/contacts/');
  });

  it('a contact Mailjet does not know (404, or an empty answer) is « absent »: no DELETE', async () => {
    const a = fakeFetch(() => ({ status: 404, body: { ErrorMessage: 'Object not found', StatusCode: 404 } }));
    expect(await eraser({ fetchImpl: a.fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase(ADDRESS)).toEqual({ outcome: 'absent', status: 404 });
    expect(a.calls.map((c) => c.method)).toEqual(['GET']);
    const b = fakeFetch(() => ({ status: 200, body: { Count: 0, Data: [], Total: 0 } }));
    expect((await eraser({ fetchImpl: b.fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase(ADDRESS)).outcome).toBe('absent');
  });
});

describe('Mailjet contact erasure — no-op without a Mailjet account', () => {
  it.each([['noop', 'pub:sec'], ['test', 'pub:sec'], ['resend', 're_key'], ['msgraph', ''], ['mailjet', ''], ['mailjet', 'no-colon']])('provider %s / key « %s »: skipped, no HTTP call, no KV write', async (provider, apiKey) => {
    const { fetchImpl, calls } = fakeFetch(() => 'throw');
    const kv = fakeKv();
    const e = createMailContactEraser({ fetchImpl, kv, logger: fakeLogger(), config: () => ({ provider, apiKey }) });
    expect(e.active()).toBe(false);
    expect(await e.erase(ADDRESS)).toEqual({ outcome: 'skipped' });
    expect(await e.eraseMany([ADDRESS, 'other@example.test'])).toEqual({ skipped: 2, absent: 0, deleted: 0, failed: 0 });
    expect(calls).toEqual([]);
    expect(kv.lists.size).toBe(0);
  });

  it('the process eraser reads MAILER_PROVIDER: with the default (noop) nothing is called', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'noop');
    const spy = vi.fn(async () => { throw new Error('network must not be used'); });
    vi.stubGlobal('fetch', spy);
    const { mailContactEraser } = await import('../../api/_services/mail-contact-erasure.js');
    expect(await mailContactEraser.erase(ADDRESS)).toEqual({ outcome: 'skipped' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Mailjet contact erasure — a failure is « failed », never « deleted », and nothing is queued (owner decision C6)', () => {
  it('a failing DELETE (500 twice) is « failed » at step delete: no KV write, no address and no contact id in the logs', async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.method === 'GET' ? FOUND : { status: 500 }));
    const kv = fakeKv(); const log = fakeLogger();
    const out = await eraser({ fetchImpl, kv, logger: log }).erase(ADDRESS, { reason: 'account_erasure' });
    expect(out).toEqual({ outcome: 'failed', step: 'delete', status: 500 });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'DELETE']);
    expect(kv.lists.size, 'no retry list holding the address or the contact id').toBe(0);
    expect(JSON.stringify(log.lines)).not.toMatch(/example\.test|12345678/);
    expect(JSON.stringify(log.lines)).toContain('mail_contact.erasure_failed');
  });

  it('a lookup that fails (network error, 503, 401, a malformed id) is « failed » at step lookup, logged without the address', async () => {
    for (const answer of [() => /** @type {const} */ ('throw'), () => ({ status: 503 }), () => ({ status: 401 }), () => ({ status: 200, body: { Count: 1, Data: [{ ID: 'not-a-number' }] } })]) {
      const { fetchImpl, calls } = fakeFetch(answer);
      const kv = fakeKv(); const log = fakeLogger();
      const out = await eraser({ fetchImpl, kv, logger: log }).erase(ADDRESS);
      expect(out).toMatchObject({ outcome: 'failed', step: 'lookup' });
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
      expect(kv.lists.size).toBe(0);
      expect(JSON.stringify(log.lines)).not.toContain('example.test');
    }
  });

  it('a 5xx or an unreachable provider is tried twice, a 4xx once; a 429 on the lookup is retried and then succeeds', async () => {
    const a = fakeFetch(() => ({ status: 503 }));
    await eraser({ fetchImpl: a.fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase(ADDRESS);
    expect(a.calls).toHaveLength(2);
    const b = fakeFetch(() => ({ status: 401 }));
    await eraser({ fetchImpl: b.fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase(ADDRESS);
    expect(b.calls).toHaveLength(1);
    let n = 0;
    const c = fakeFetch((call) => { n += 1; return n === 1 ? { status: 429 } : call.method === 'GET' ? FOUND : { status: 200 }; });
    expect((await eraser({ fetchImpl: c.fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase(ADDRESS)).outcome).toBe('deleted');
    expect(c.calls.map((x) => x.method)).toEqual(['GET', 'GET', 'DELETE']);
  });

  it('a fetch or a logger that throws cannot escape; a logger failing after a real deletion does not turn it into a failure', async () => {
    const fetchImpl = /** @type {any} */ (() => { throw new Error('boom'); });
    await expect(eraser({ fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase(ADDRESS)).resolves.toMatchObject({ outcome: 'failed' });
    const ok = fakeFetch((c) => (c.method === 'GET' ? FOUND : { status: 200 }));
    const badLog = { info: () => { throw new Error('log down'); }, warn() {}, error() {} };
    expect((await eraser({ fetchImpl: ok.fetchImpl, kv: fakeKv(), logger: badLog }).erase(ADDRESS)).outcome).toBe('deleted');
  });

  it('eraseMany de-duplicates, counts each outcome and reports each result without the address', async () => {
    const { fetchImpl } = fakeFetch((c) => (c.method === 'GET' ? (c.path.includes('gone') ? { status: 404 } : c.path.includes('down') ? { status: 503 } : FOUND) : { status: 200 }));
    /** @type {any[]} */ const seen = [];
    const totals = await eraser({ fetchImpl, kv: fakeKv(), logger: fakeLogger() }).eraseMany(['a@example.test', 'a@example.test', 'gone@example.test', 'down@example.test', '', null], { onResult: (r) => seen.push(r) });
    expect(totals).toEqual({ skipped: 0, absent: 1, deleted: 1, failed: 1 });
    expect(JSON.stringify(seen)).not.toContain('example.test');
  });

  it('the source has no enqueue of new ids; the v5 list is only drained (legacy)', () => {
    const src = readFileSync('api/_services/mail-contact-erasure.js', 'utf8');
    expect(src).not.toMatch(/enqueue\(|'queued'|'unresolved'/);
    expect(src).toContain('LEGACY ONLY');
  });
});

describe('Mailjet contact erasure — legacy v5 retry list: one pass, then deleted; nothing written back to Upstash', () => {
  it('each id is tried once (oldest first); the list is deleted; failures are counted, never put back', async () => {
    const kv = fakeKv();
    for (const id of ['111', '222', '333']) await kv.lpush(MAIL_CONTACT_PENDING_KEY, JSON.stringify({ kind: 'ada-mail-contact-erasure', contactId: id, queuedAt: '2026-11-15T00:00:00.000Z', attempts: 0 }));
    await kv.lpush(MAIL_CONTACT_PENDING_KEY, 'not json');
    let writes = 0; const counted = { ...kv, async lpush(/** @type {any[]} */ ...a) { writes += 1; return kv.lpush(...a); } };
    const { fetchImpl, calls } = fakeFetch((c) => (c.path.endsWith('/111') ? { status: 200 } : c.path.endsWith('/222') ? { status: 404 } : { status: 500 }));
    expect(await eraser({ fetchImpl, kv: counted, logger: fakeLogger() }).drainPending()).toEqual({ tried: 3, deleted: 2, failed: 1, remaining: 0 });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v4/contacts/111', '/v4/contacts/222', '/v4/contacts/333', '/v4/contacts/333']);
    expect(kv.lists.has(MAIL_CONTACT_PENDING_KEY)).toBe(false);
    expect(writes).toBe(0);
  });
  it('an empty list makes no call; without credentials the list is left and reported; a KV failure is swallowed', async () => {
    const a = fakeFetch(() => 'throw');
    expect(await eraser({ fetchImpl: a.fetchImpl, kv: fakeKv(), logger: fakeLogger() }).drainPending()).toEqual({ tried: 0, deleted: 0, failed: 0, remaining: 0 });
    const kv = fakeKv(); await kv.lpush(MAIL_CONTACT_PENDING_KEY, JSON.stringify({ kind: 'ada-mail-contact-erasure', contactId: '9', attempts: 0 }));
    const off = createMailContactEraser({ fetchImpl: a.fetchImpl, kv, logger: fakeLogger(), config: () => ({ provider: 'noop', apiKey: '' }) });
    expect((await off.drainPending()).remaining).toBe(1);
    const broken = { ...fakeKv(), async lrange() { throw new Error('kv down'); } };
    await expect(eraser({ fetchImpl: a.fetchImpl, kv: broken, logger: fakeLogger() }).drainPending()).resolves.toMatchObject({ tried: 0 });
  });
  it('the module never writes to the KV store (no lpush / set anywhere)', () => {
    const src = readFileSync('api/_services/mail-contact-erasure.js', 'utf8');
    expect(src).not.toMatch(/kv\.(lpush|rpush|set|ltrim)\(/);
  });
});

describe('the retry window: bounded, and always inside the one-month answer deadline (GDPR art. 12(3))', () => {
  const now = new Date('2026-11-17T10:00:00.000Z');
  it(`${MAIL_CONTACT_RETRY_WINDOW_DAYS} days after the first failure for a fresh request`, () => {
    const w = mailContactRetryWindow({ createdAt: '2026-11-10T09:00:00.000Z' }, now);
    expect(w.open).toBe(true);
    expect(w.until.getTime()).toBe(now.getTime() + MAIL_CONTACT_RETRY_WINDOW_DAYS * DAY);
    const later = mailContactRetryWindow({ createdAt: '2026-11-10T09:00:00.000Z', reviewOutcome: { mailContactRetry: { firstFailedAt: '2026-11-13T10:00:00.000Z' } } }, now);
    expect(later.open, 'first failure 4 days ago: closed').toBe(false);
  });
  it(`never later than ${MAIL_CONTACT_DEADLINE_MARGIN_DAYS} days before the deadline: a late approval does not wait at all`, () => {
    // received 20/10 → due 20/11 23:59:59.999 UTC → the window ends 17/11 23:59:59.999 at the latest
    const w = mailContactRetryWindow({ createdAt: '2026-10-20T08:00:00.000Z' }, now);
    expect(w.until.toISOString()).toBe('2026-11-17T23:59:59.999Z');
    expect(mailContactRetryWindow({ createdAt: '2026-10-16T08:00:00.000Z' }, now).open).toBe(false);
  });
});

describe('account erasure: the contact first, while the address is in the account row', () => {
  const cryptoLib = { createHash: () => ({ update() { return this; }, digest: () => 'h' }), randomBytes: () => ({ toString: () => 'x' }) };
  const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  /** @param {string[]} order @param {any} [request] */
  function fakeDb(order, request = { id: 'req1', subjectId: 'u1', requestType: 'DELETE', status: 'APPROVED', createdAt: new Date().toISOString() }) {
    /** @type {any[]} */ const inserts = [];
    const db = /** @type {any} */ ({
      inserts,
      query: {
        CitizenUser: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', email: ADDRESS }) },
        DSRRequest: { findFirst: vi.fn(async () => ({ ...request })), findMany: vi.fn().mockResolvedValue([]) },
        ProAppointment: empty(), ConversationLog: empty(), AuthToken: empty(), SharedDiagnostic: empty(), ConsentLog: empty(), RdvConversation: empty(), UserConsent: empty(),
        GuardianRelationship: empty(), RdvConversationMessage: empty(), RdvNotificationLog: empty(), AuditLog: empty(), LegalHold: empty(),
      },
      delete: vi.fn(() => ({ where: () => ({ returning: async () => { order.push('db.delete'); return [{ id: 'u1' }]; } }) })),
      update: vi.fn(() => ({ set: (/** @type {any} */ p) => ({ where: () => ({ returning: async () => { if (p?.status) request.status = p.status; return [{ id: 'req1' }]; } }) }) })),
      insert: vi.fn(() => ({ values: async (/** @type {any} */ v) => { inserts.push(v); return []; } })),
    });
    db.transaction = async (/** @type {any} */ fn) => { const r = await fn(db); order.push('commit'); return r; };
    return db;
  }
  const tombstones = (/** @type {string[]} */ order) => ({ record: vi.fn(async () => { order.push('tomb.record'); }), abort: vi.fn(async () => { order.push('tomb.abort'); }), complete: vi.fn(async () => true) });

  it('success: Mailjet is called before the tombstone and the database deletion; the outcome is in the summary', async () => {
    /** @type {string[]} */ const order = [];
    const mailContacts = { erase: vi.fn(async () => { order.push('mail.erase'); return { outcome: 'deleted', status: 200 }; }) };
    const db = fakeDb(order);
    const s = createPrivacyRightsService({ db, cryptoLib, tombstones: tombstones(order), mailContacts: /** @type {any} */ (mailContacts) });
    const summary = await s.executeApprovedDeletion('req1');
    expect(mailContacts.erase).toHaveBeenCalledWith(ADDRESS, { reason: 'account_erasure' });
    expect(order.indexOf('mail.erase')).toBeLessThan(order.indexOf('tomb.record'));
    expect(order.indexOf('mail.erase')).toBeLessThan(order.indexOf('db.delete'));
    expect(summary).toMatchObject({ profileDeleted: 1, mailContact: 'deleted' });
    expect(db.inserts.some((v) => v.action === MAIL_CONTACT_FAILED)).toBe(false);
  });

  it('failure inside the window: nothing erased, no tombstone, an address-free MAIL_CONTACT_PENDING error for the caller to park the request', async () => {
    /** @type {string[]} */ const order = [];
    const mailContacts = { erase: vi.fn(async () => ({ outcome: 'failed', step: 'lookup', status: 503 })) };
    const db = fakeDb(order);
    const s = createPrivacyRightsService({ db, cryptoLib, tombstones: tombstones(order), mailContacts: /** @type {any} */ (mailContacts) });
    const err = await s.executeApprovedDeletion('req1').catch((e) => e);
    expect(err.code).toBe('MAIL_CONTACT_PENDING');
    expect(err.mailContact).toMatchObject({ step: 'lookup', status: 503 });
    expect(order).toEqual([]);
    expect(JSON.stringify({ message: err.message, mc: err.mailContact })).not.toContain('example.test');
  });

  it('failure once the window is closed: the account is erased, the failure recorded « intervention humaine requise », never reported as deleted', async () => {
    /** @type {string[]} */ const order = [];
    const mailContacts = { erase: vi.fn(async () => { throw new Error('provider down'); }) };
    const old = { id: 'req1', subjectId: 'u1', requestType: 'DELETE', status: 'APPROVED', createdAt: new Date().toISOString(),
      reviewOutcome: { mailContactRetry: { firstFailedAt: new Date(Date.now() - 4 * DAY).toISOString(), attempts: 3 } } };
    const db = fakeDb(order, old);
    const s = createPrivacyRightsService({ db, cryptoLib, tombstones: tombstones(order), mailContacts: /** @type {any} */ (mailContacts) });
    const summary = await s.executeApprovedDeletion('req1');
    expect(summary).toMatchObject({ profileDeleted: 1, mailContact: 'failed', mailContactHumanIntervention: 1, mailContactFailureRecorded: 1 });
    const rec = db.inserts.find((v) => v.action === MAIL_CONTACT_FAILED);
    expect(rec.details).toEqual({ reason: 'account_erasure', step: 'internal', status: null, count: 1, attempts: 4, requestId: 'req1', humanInterventionRequired: true, label: 'intervention humaine requise' });
    expect(JSON.stringify(db.inserts)).not.toContain('example.test');
  });

  it('deleteDataDomains (also used by the restore replay) no longer calls the provider', async () => {
    const mailContacts = { erase: vi.fn() };
    const s = createPrivacyRightsService({ db: fakeDb([]), cryptoLib, mailContacts: /** @type {any} */ (mailContacts) });
    await s.deleteDataDomains('u1', ['CitizenProfile'], { requestId: 'req1' });
    expect(mailContacts.erase).not.toHaveBeenCalled();
  });
});

describe('the failure record holds no address', () => {
  it('only known labels and numbers are written; a note holding an address is refused', async () => {
    /** @type {any[]} */ const rows = [];
    const db = { insert: () => ({ values: async (/** @type {any} */ v) => { rows.push(v); } }), execute: async () => ({ rows: [] }) };
    expect(await recordMailContactFailure(db, /** @type {any} */ ({ reason: ADDRESS, step: ADDRESS, status: 503, requestId: null }))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('example.test');
    expect(rows[0]).toMatchObject({ action: MAIL_CONTACT_FAILED, entity: 'MAIL_CONTACT', details: { reason: 'account_erasure', step: 'internal', status: 503, humanInterventionRequired: true } });
    expect(await recordMailContactFailure({ insert: () => { throw new Error('db down'); } }, { reason: 'email_change' })).toBe(false);
    expect((await resolveMailContactFailure('x', { note: `fait pour ${ADDRESS}` }, 'admin@example.test', db)).code).toBe('address_in_note');
    expect((await resolveMailContactFailure('x', { note: 'ok' }, 'admin@example.test', db)).code).toBe('note_required');
  });
});

describe('purge step 6c and the confirmed change of address use the same eraser, and record failures', () => {
  const purge = readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8');
  const change = readFileSync('api/_services/email-change.js', 'utf8');
  it('6c calls Mailjet BEFORE the deletion transaction, deletes the accounts whatever it answers, records and names a failure', () => {
    const step = purge.slice(purge.indexOf("id: 'unverifiedAccountsDeleted'"), purge.indexOf('// 7. Old AI Metrics'));
    expect(step).toMatch(/before: async \(db, ctx\) => \{/);
    expect(step).toContain("mailContactEraser.eraseMany(found.map((/** @type {{ email: string }} */ r) => r.email), { reason: 'unverified_account_purge'");
    expect(step).toContain("recordMailContactFailure(db, { reason: 'unverified_account_purge'");
    expect(step).toContain("'mailContactErasure'");
    expect(purge).toContain('const prep = typeof step.before === \'function\' ? await step.before(database, ctx) : undefined;');
    expect(purge).toContain('retryMailContactErasures');
  });
  it('the change of address erases the OLD address after the response and records a failure', () => {
    expect(change).toContain("const r = /** @type {any} */ (await mailContacts.erase(address, { reason: 'email_change' }));");
    expect(change).toContain("if (r?.outcome === 'failed') await recordMailContactFailure(db, { reason: 'email_change', step: r.step, status: r.status ?? null });");
  });
});
