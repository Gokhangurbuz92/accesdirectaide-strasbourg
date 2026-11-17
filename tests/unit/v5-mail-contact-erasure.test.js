/**
 * Legal v5 (15/11/2026) — the recipient's Mailjet contact is deleted when a citizen account is erased, when a never-confirmed account is purged (6c)
 * and, for the OLD address, when a change of address is confirmed (api/_services/mail-contact-erasure.js; Mailjet « GDPR Delete contacts »:
 * GET /v3/REST/contact/{email} then DELETE /v4/contacts/{contact_ID}). The HTTP layer is a mock: any host but api.mailjet.com throws, nothing leaves the
 * machine, no real key or address is used. Fail-safe: a provider error never throws, never blocks an erasure, and no log line carries the address.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailContactEraser, MAIL_CONTACT_PENDING_KEY } from '../../api/_services/mail-contact-erasure.js';
import { createPrivacyRightsService } from '../../api/_services/privacy.js';

const ADDRESS = 'v5-erased.person+tag@example.test';
const MAILJET = () => ({ provider: 'mailjet', apiKey: 'pub_test:sec_test' });
const BASIC = `Basic ${Buffer.from('pub_test:sec_test').toString('base64')}`;

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
  it('looks the contact up by address, then deletes it by id on the v4 endpoint, with the Send API credentials', async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.method === 'GET' ? FOUND : { status: 200, body: { Count: 1 } }));
    const log = fakeLogger();
    const out = await eraser({ fetchImpl, kv: fakeKv(), logger: log }).erase(ADDRESS, { reason: 'account_erasure' });
    expect(out).toEqual({ outcome: 'deleted', status: 200 });
    expect(calls).toEqual([
      { method: 'GET', path: `/v3/REST/contact/${encodeURIComponent(ADDRESS)}`, auth: BASIC },
      { method: 'DELETE', path: '/v4/contacts/12345678', auth: BASIC },
    ]);
    expect(JSON.stringify(log.lines)).not.toContain('example.test');
    expect(JSON.stringify(log.lines)).not.toContain('12345678');
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
    expect(await e.eraseMany([ADDRESS, 'other@example.test'])).toMatchObject({ skipped: 2, deleted: 0, unresolved: 0 });
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

  it('an empty address is skipped', async () => {
    const { fetchImpl, calls } = fakeFetch(() => 'throw');
    expect((await eraser({ fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase('  ')).outcome).toBe('skipped');
    expect(calls).toEqual([]);
  });
});

describe('Mailjet contact erasure — fail-safe', () => {
  it('a failing DELETE (500 twice) queues the NUMERIC contact id — never the address — and never throws', async () => {
    const { fetchImpl, calls } = fakeFetch((c) => (c.method === 'GET' ? FOUND : { status: 500 }));
    const kv = fakeKv(); const log = fakeLogger();
    const out = await eraser({ fetchImpl, kv, logger: log }).erase(ADDRESS, { reason: 'account_erasure' });
    expect(out).toEqual({ outcome: 'queued', status: 500 });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'DELETE']);
    const queued = kv.lists.get(MAIL_CONTACT_PENDING_KEY) || [];
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0])).toMatchObject({ kind: 'ada-mail-contact-erasure', contactId: '12345678', attempts: 0 });
    expect(queued[0]).not.toContain('@');
    expect(JSON.stringify(log.lines)).not.toMatch(/example\.test|12345678/);
    expect(JSON.stringify(log.lines)).toContain('mail_contact.erasure_queued');
  });

  it('a lookup that fails (network error, then 503) is « unresolved »: nothing queued, logged without the address', async () => {
    for (const answer of [() => /** @type {const} */ ('throw'), () => ({ status: 503 }), () => ({ status: 401 }), () => ({ status: 200, body: { Count: 1, Data: [{ ID: 'not-a-number' }] } })]) {
      const { fetchImpl, calls } = fakeFetch(answer);
      const kv = fakeKv(); const log = fakeLogger();
      const out = await eraser({ fetchImpl, kv, logger: log }).erase(ADDRESS);
      expect(out.outcome).toBe('unresolved');
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
      expect(kv.lists.size).toBe(0);
      expect(JSON.stringify(log.lines)).toContain('mail_contact.erasure_unresolved');
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

  it('when the retry list itself cannot be written, the result is « unresolved » and still nothing throws', async () => {
    const { fetchImpl } = fakeFetch((c) => (c.method === 'GET' ? FOUND : { status: 500 }));
    const kv = { ...fakeKv(), async lpush() { throw new Error('kv down'); } };
    expect((await eraser({ fetchImpl, kv, logger: fakeLogger() }).erase(ADDRESS)).outcome).toBe('unresolved');
  });

  it('a logger or fetch that throws synchronously cannot escape', async () => {
    const fetchImpl = /** @type {any} */ (() => { throw new Error('boom'); });
    await expect(eraser({ fetchImpl, kv: fakeKv(), logger: fakeLogger() }).erase(ADDRESS)).resolves.toMatchObject({ outcome: 'unresolved' });
  });
});

describe('Mailjet contact erasure — the retry list', () => {
  it('drainPending deletes the queued ids (oldest first); an id leaves the list on 200 or 404 and stays on any other answer', async () => {
    const kv = fakeKv();
    for (const id of ['111', '222', '333']) await kv.lpush(MAIL_CONTACT_PENDING_KEY, JSON.stringify({ kind: 'ada-mail-contact-erasure', contactId: id, queuedAt: '2026-11-15T00:00:00.000Z', attempts: 0 }));
    await kv.lpush(MAIL_CONTACT_PENDING_KEY, 'not json');
    const { fetchImpl, calls } = fakeFetch((c) => (c.path.endsWith('/111') ? { status: 200 } : c.path.endsWith('/222') ? { status: 404 } : { status: 500 }));
    const out = await eraser({ fetchImpl, kv, logger: fakeLogger() }).drainPending();
    expect(out).toEqual({ tried: 3, deleted: 2, remaining: 1 });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v4/contacts/111', '/v4/contacts/222', '/v4/contacts/333', '/v4/contacts/333']);
    const left = (kv.lists.get(MAIL_CONTACT_PENDING_KEY) || []).map((x) => JSON.parse(x));
    expect(left).toEqual([{ kind: 'ada-mail-contact-erasure', contactId: '333', queuedAt: '2026-11-15T00:00:00.000Z', attempts: 1 }]);
  });

  it('an empty list makes no call; without a Mailjet account the list is left alone and reported', async () => {
    const a = fakeFetch(() => 'throw');
    expect(await eraser({ fetchImpl: a.fetchImpl, kv: fakeKv(), logger: fakeLogger() }).drainPending()).toEqual({ tried: 0, deleted: 0, remaining: 0 });
    const kv = fakeKv();
    await kv.lpush(MAIL_CONTACT_PENDING_KEY, JSON.stringify({ kind: 'ada-mail-contact-erasure', contactId: '9', attempts: 0 }));
    const off = createMailContactEraser({ fetchImpl: a.fetchImpl, kv, logger: fakeLogger(), config: () => ({ provider: 'noop', apiKey: '' }) });
    expect(await off.drainPending()).toEqual({ tried: 0, deleted: 0, remaining: 1 });
    expect(a.calls).toEqual([]);
    expect(kv.lists.get(MAIL_CONTACT_PENDING_KEY)).toHaveLength(1);
  });

  it('a KV failure while draining is swallowed', async () => {
    const kv = { ...fakeKv(), async lrange() { throw new Error('kv down'); } };
    await expect(eraser({ fetchImpl: fakeFetch(() => 'throw').fetchImpl, kv, logger: fakeLogger() }).drainPending()).resolves.toMatchObject({ tried: 0 });
  });

  it('eraseMany de-duplicates and counts each outcome', async () => {
    const { fetchImpl } = fakeFetch((c) => (c.method === 'GET' ? (c.path.includes('gone') ? { status: 404 } : c.path.includes('down') ? { status: 503 } : FOUND) : { status: 200 }));
    const totals = await eraser({ fetchImpl, kv: fakeKv(), logger: fakeLogger() }).eraseMany(['a@example.test', 'a@example.test', 'gone@example.test', 'down@example.test', '', null]);
    expect(totals).toEqual({ skipped: 0, absent: 1, deleted: 1, queued: 0, unresolved: 1 });
  });
});

describe('account erasure calls the contact deletion after the commit, and survives its failure', () => {
  const cryptoLib = { createHash: () => ({ update() { return this; }, digest: () => 'h' }), randomBytes: () => ({ toString: () => 'x' }) };
  const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  /** @param {string[]} order */
  function fakeDb(order) {
    const db = /** @type {any} */ ({
      query: {
        CitizenUser: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', email: ADDRESS }) },
        DSRRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'req1', subjectId: 'u1', requestType: 'DELETE', status: 'APPROVED' }), findMany: vi.fn().mockResolvedValue([]) },
        ProAppointment: empty(), ConversationLog: empty(), AuthToken: empty(), SharedDiagnostic: empty(), ConsentLog: empty(), RdvConversation: empty(), UserConsent: empty(),
        GuardianRelationship: empty(), RdvConversationMessage: empty(), RdvNotificationLog: empty(), AuditLog: empty(), LegalHold: empty(),
      },
      delete: vi.fn(() => ({ where: () => ({ returning: async () => { order.push('db.delete'); return [{ id: 'u1' }]; } }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) })),
      insert: vi.fn(() => ({ values: async () => [] })),
    });
    db.transaction = async (/** @type {any} */ fn) => { const r = await fn(db); order.push('commit'); return r; };
    return db;
  }

  it('the address of the erased account is handed to the eraser once the transaction has committed; the outcome is in the summary', async () => {
    /** @type {string[]} */ const order = [];
    const mailContacts = { erase: vi.fn(async () => { order.push('mail.erase'); return { outcome: 'deleted' }; }), drainPending: vi.fn(async () => { order.push('mail.drain'); return { tried: 0, deleted: 0, remaining: 0 }; }) };
    const service = createPrivacyRightsService({ db: fakeDb(order), cryptoLib, mailContacts: /** @type {any} */ (mailContacts) });
    const summary = await service.deleteDataDomains('u1', ['CitizenProfile'], { requestId: 'req1' });
    expect(mailContacts.erase).toHaveBeenCalledWith(ADDRESS, { reason: 'account_erasure' });
    expect(order.indexOf('commit')).toBeGreaterThan(-1);
    expect(order.indexOf('mail.erase')).toBeGreaterThan(order.indexOf('commit'));
    expect(order.at(-1)).toBe('mail.drain');
    expect(summary).toMatchObject({ profileDeleted: 1, mailContact: 'deleted', mailContactUnresolved: 0 });
  });

  it('a provider failure — even a thrown one — does not undo or block the erasure; it is flagged in the summary', async () => {
    for (const erase of [vi.fn(async () => ({ outcome: 'unresolved' })), vi.fn(async () => { throw new Error('provider down'); })]) {
      const mailContacts = { erase, drainPending: vi.fn(async () => { throw new Error('kv down'); }) };
      const service = createPrivacyRightsService({ db: fakeDb([]), cryptoLib, mailContacts: /** @type {any} */ (mailContacts) });
      const summary = await service.deleteDataDomains('u1', ['CitizenProfile'], { requestId: 'req1' });
      expect(summary).toMatchObject({ profileDeleted: 1, mailContact: 'unresolved', mailContactUnresolved: 1 });
    }
  });

  it('an erasure that does not remove the account (other domains only) leaves the contact alone', async () => {
    const mailContacts = { erase: vi.fn(), drainPending: vi.fn() };
    const service = createPrivacyRightsService({ db: fakeDb([]), cryptoLib, mailContacts: /** @type {any} */ (mailContacts) });
    await service.deleteDataDomains('u1', ['CitizenAppointment'], { requestId: 'req1' });
    expect(mailContacts.erase).not.toHaveBeenCalled();
  });
});

describe('the purge of never-confirmed accounts (6c) and the confirmed change of address are wired to the same eraser', () => {
  const purge = readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8');
  const change = readFileSync('api/_services/email-change.js', 'utf8');
  it('6c deletes the contacts of the rows it actually removed, after the commit, and names the failed step', () => {
    const step = purge.slice(purge.indexOf("id: 'unverifiedAccountsDeleted'"), purge.indexOf('// 7. Old AI Metrics'));
    expect(step).toContain('.returning({ id: CitizenUser.id })');
    expect(step).toMatch(/afterCommit: async \(\) => \(\(await mailContactEraser\.eraseMany\(emails, \{ reason: 'unverified_account_purge' \}\)\)\.unresolved > 0 \? 'mailContactErasure' : null\)/);
    expect(purge).toContain("failedSteps.push('mailContactRetry')");
  });
  it('the change of address erases the OLD address only once the change has committed, after the response', () => {
    expect(change).toMatch(/if \(out\.ok && out\.status === 'changed' && oldEmail\) \{ const address = oldEmail; afterResponse\(\(\) => mailContacts\.erase\(address, \{ reason: 'email_change' \}\), 'mail-contact-erasure'\); \}/);
  });
});
