/**
 * SharedDossier <-> structure chat: AUTHORIZATION LOGIC of secure-messages (pro side) and share/thread (sharer side).
 * MOCK-LEVEL: the data-access service is replaced by an in-memory fake with the same contract (unique thread per dossier+structure,
 * cascade by dossier). The SQL itself is exercised by tests/integration/shared-dossier-thread-db.test.js (needs a PostgreSQL).
 */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('AUTH_SECRET', 'test-auth-secret-dossier');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../src/db/index.js', () => ({ db: { query: { RdvConversation: { findFirst: vi.fn().mockResolvedValue(undefined) } }, insert: vi.fn(), update: vi.fn() } }));

const store = { dossiers: new Map(), threads: [], messages: [] };
// RC5: structure grants (redeemed share token). The authorization LOGIC of secure-messages consults findGrant; the SQL is covered by tests/integration/rc5-dossier-authz-db.test.js.
const grants = new Map();
vi.mock('../../api/_utils/share-access.js', async (orig) => ({ ...(await orig()), findActiveGrant: async (d, ctx) => grants.get(`${d}|${ctx.structureId}`) || null }));   // real owner/token logic, scripted grants
vi.mock('../../api/_services/shared-dossier-threads.js', async () => {
  const dk = await vi.importActual('../../api/lib/data-keys.js');
  return {
  sealMessage: (tid, t) => dk.sealText(t, { purpose: 'dossier-message', context: `thread:${tid}` }),
  openMessage: (tid, b) => dk.openText(b, { purpose: 'dossier-message', context: `thread:${tid}` }),
  getDossier: async (id) => store.dossiers.get(id) || null,
  isExpired: (d) => !(new Date(d.expiresAt).getTime() > Date.now()),
  findThread: async (d, s) => store.threads.find((t) => t.sharedDiagnosticId === d && t.structureId === s) || null,
  findThreadOfDossier: async (d, tid) => store.threads.find((t) => t.id === tid && t.sharedDiagnosticId === d) || null,
  openThread: async ({ dossierId, structureId, proUserId }) => {
    let t = store.threads.find((x) => x.sharedDiagnosticId === dossierId && x.structureId === structureId);
    if (!t) { t = { id: crypto.randomUUID(), sharedDiagnosticId: dossierId, structureId, openedByProUserId: proUserId, createdAt: new Date(), lastMessageAt: new Date() }; store.threads.push(t); }
    return t;
  },
  listThreads: async (d) => store.threads.filter((t) => t.sharedDiagnosticId === d).map((t) => ({ id: t.id, structureName: 'Structure ' + t.structureId, lastMessageAt: t.lastMessageAt, createdAt: t.createdAt })),
  listMessages: async (tid) => store.messages.filter((m) => m.threadId === tid),
  addMessage: async (m) => { const row = { id: crypto.randomUUID(), createdAt: new Date(), ...m }; store.messages.push(row); return row; },
  };
});

import secureMessages from '../../api/_handlers/secure-messages.js';
import shareThread from '../../api/_handlers/share/thread.js';
import { signProToken } from '../../api/_utils/auth.js';
import { verifyCapability } from '../../api/_utils/share-capability.js';

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const pro = (id, sid) => `Bearer ${signProToken({ id, email: `${id}@example.test`, structureId: sid, role: 'STRUCTURE_ADMIN' })}`;
const callPro = async (method, { query = '', body, token } = {}) => { const r = mk(); await secureMessages({ method, url: `/api/secure-messages${query}`, query: {}, body, headers: { host: 'x', ...(token ? { authorization: token } : {}) } }, r); return r; };
const callShare = async (body, method = 'POST') => { const r = mk(); await shareThread({ method, url: '/api/share/thread', query: {}, body, headers: { host: 'x' } }, r); return r; };
const cap = () => crypto.randomBytes(32).toString('base64url');
const hash = (c) => crypto.createHash('sha256').update(c, 'utf8').digest('hex');
const addDossier = (id, c, ttlMs = 3600_000) => store.dossiers.set(id, { id, expiresAt: new Date(Date.now() + ttlMs), rightsSecretHash: hash(c), shareTokenHash: hash('recipient-' + c) });   // RC5 row: distinct owner secret and share token

describe('SharedDossier chat authorization (MOCK-level data layer)', () => {
  let D1, D2, C1, C2;
  beforeEach(() => {
    store.dossiers.clear(); store.threads.length = 0; store.messages.length = 0; grants.clear();
    D1 = 'dos-' + crypto.randomUUID(); D2 = 'dos-' + crypto.randomUUID(); C1 = cap(); C2 = cap(); addDossier(D1, C1); addDossier(D2, C2);
    for (const d of [D1, D2]) for (const st of ['S-A', 'S-B']) grants.set(`${d}|${st}`, { revokedAt: null });
  });

  it('verifyCapability: constant-time check, fails closed on malformed input', () => {
    expect(verifyCapability(C1, hash(C1))).toBe(true);
    expect(verifyCapability(C2, hash(C1))).toBe(false);
    for (const bad of ['', null, undefined, 'x'.repeat(513)]) expect(verifyCapability(bad, hash(C1))).toBe(false);
    expect(verifyCapability(C1, 'not-a-hash')).toBe(false); expect(verifyCapability(C1, null)).toBe(false);
  });

  it('pro: unauthenticated → 401; first message opens ONE thread per structure; other structure sees nothing', async () => {
    expect((await callPro('GET', { query: `?shareId=${D1}` })).statusCode).toBe(401);
    const A = pro('pa', 'S-A'), B = pro('pb', 'S-B');
    expect((await callPro('GET', { query: `?shareId=${D1}`, token: A })).body.items).toEqual([]);
    const sent = await callPro('POST', { token: A, body: { shareId: D1, encryptedContent: 'blob-from-A' } });
    expect(sent.statusCode).toBe(201);
    await callPro('POST', { token: A, body: { shareId: D1, encryptedContent: 'blob-from-A-2' } });
    expect(store.threads.filter((t) => t.sharedDiagnosticId === D1 && t.structureId === 'S-A')).toHaveLength(1);
    expect(store.messages[0].body).toMatch(/^v2:/);                           // envelope v2: random per-message data key bound to the thread
    expect(store.messages[0].body).not.toContain('blob-from-A');
    const a = await callPro('GET', { query: `?shareId=${D1}`, token: A }); expect(a.body.items.map((i) => i.encryptedContent)).toEqual(['blob-from-A', 'blob-from-A-2']);
    expect((await callPro('GET', { query: `?shareId=${D1}`, token: B })).body.items).toEqual([]);     // structure isolation
    await callPro('POST', { token: B, body: { shareId: D1, encryptedContent: 'blob-from-B' } });
    expect(store.threads.filter((t) => t.sharedDiagnosticId === D1)).toHaveLength(2);                // separate thread, not A's
    expect((await callPro('GET', { query: `?shareId=${D1}`, token: A })).body.items).toHaveLength(2);
  });

  it('pro: expired dossier → 410 on read and write; unknown id and oversize/empty payloads are rejected', async () => {
    const A = pro('pa', 'S-A'); store.dossiers.set('old', { id: 'old', expiresAt: new Date(Date.now() - 1000), rightsSecretHash: hash(C1), shareTokenHash: hash('recipient-' + C1) }); grants.set('old|S-A', { revokedAt: null });
    expect((await callPro('GET', { query: '?shareId=old', token: A })).statusCode).toBe(410);
    expect((await callPro('POST', { token: A, body: { shareId: 'old', encryptedContent: 'x' } })).statusCode).toBe(410);
    expect((await callPro('POST', { token: A, body: { shareId: 'does-not-exist', encryptedContent: 'x' } })).statusCode).toBe(404);   // falls through to the legacy conversation path
    expect((await callPro('POST', { token: A, body: { shareId: D1, encryptedContent: 'x'.repeat(33 * 1024) } })).statusCode).toBe(413);
    expect((await callPro('POST', { token: A, body: { shareId: D1, encryptedContent: '' } })).statusCode).toBe(400);
    expect(store.threads).toHaveLength(0);
  });

  it('RC5 legacy rows have NO owner: the single link secret of a pre-RC5 dossier cannot answer chats or list threads', async () => {
    const legacy = 'dos-legacy-' + crypto.randomUUID(); const link = cap();
    store.dossiers.set(legacy, { id: legacy, expiresAt: new Date(Date.now() + 3600_000), rightsSecretHash: hash(link), shareTokenHash: null });
    expect((await callShare({ id: legacy, capability: link, action: 'list' })).statusCode).toBe(404);
    expect((await callShare({ id: D1, capability: 'recipient-' + C1, action: 'list' })).statusCode).toBe(404);       // the share token of an RC5 dossier is not the owner secret either
    expect((await callShare({ id: D1, capability: C1, action: 'list' })).statusCode).toBe(200);
  });

  it('RC5 pro: a shareId without an ACTIVE grant is not authorization - read and thread creation are a uniform 404 and create nothing', async () => {
    const C = pro('pc', 'S-C');                                                    // structure that never redeemed the share token
    expect((await callPro('GET', { query: `?shareId=${D1}`, token: C })).statusCode).toBe(404);
    expect((await callPro('POST', { token: C, body: { shareId: D1, encryptedContent: 'x' } })).statusCode).toBe(404);
    grants.delete(`${D1}|S-A`);                                                  // owner removed A's access (findActiveGrant no longer returns it)
    const A = pro('pa', 'S-A');
    expect((await callPro('GET', { query: `?shareId=${D1}`, token: A })).statusCode).toBe(404);
    expect((await callPro('POST', { token: A, body: { shareId: D1, encryptedContent: 'x' } })).statusCode).toBe(404);
    expect(store.threads).toHaveLength(0); expect(store.messages).toHaveLength(0);
  });

  it('sharer: capability required; list shows only threads of THEIR dossier; cannot read or write another dossier\'s thread', async () => {
    const A = pro('pa', 'S-A'); await callPro('POST', { token: A, body: { shareId: D1, encryptedContent: 'for-D1' } }); await callPro('POST', { token: A, body: { shareId: D2, encryptedContent: 'for-D2' } });
    const t1 = store.threads.find((t) => t.sharedDiagnosticId === D1), t2 = store.threads.find((t) => t.sharedDiagnosticId === D2);
    expect((await callShare({ id: D1, capability: 'wrong', action: 'list' })).statusCode).toBe(404);
    expect((await callShare({ id: D1, capability: C2, action: 'list' })).statusCode).toBe(404);              // capability of another dossier
    expect((await callShare({ id: 'nope', capability: C1, action: 'list' })).statusCode).toBe(404);
    expect((await callShare({ id: D1, capability: C1, action: 'bogus' })).statusCode).toBe(404);
    const list = await callShare({ id: D1, capability: C1, action: 'list' }); expect(list.statusCode).toBe(200); expect(list.body.threads.map((t) => t.id)).toEqual([t1.id]);
    const msgs = await callShare({ id: D1, capability: C1, action: 'messages', threadId: t1.id }); expect(msgs.body.items.map((i) => [i.sender, i.encryptedContent])).toEqual([['PRO', 'for-D1']]);
    expect((await callShare({ id: D1, capability: C1, action: 'messages', threadId: t2.id })).statusCode).toBe(404);   // thread of another dossier: IDOR guard
    expect((await callShare({ id: D1, capability: C1, action: 'send', threadId: t2.id, encryptedContent: 'x' })).statusCode).toBe(404);
    expect(store.messages.filter((m) => m.senderType === 'SHARER')).toHaveLength(0);
  });

  it('sharer: reply reaches the pro of that structure only; no thread creation, size limit, expiry, method', async () => {
    const A = pro('pa', 'S-A'), B = pro('pb', 'S-B'); await callPro('POST', { token: A, body: { shareId: D1, encryptedContent: 'hello' } });
    const t = store.threads[0];
    const ok = await callShare({ id: D1, capability: C1, action: 'send', threadId: t.id, encryptedContent: 'reply-blob' }); expect(ok.statusCode).toBe(201);
    expect(store.messages.at(-1)).toMatchObject({ senderType: 'SHARER', senderProUserId: null }); expect(store.messages.at(-1).body).toMatch(/^v2:/);
    const seenByA = await callPro('GET', { query: `?shareId=${D1}`, token: A }); expect(seenByA.body.items.map((i) => i.encryptedContent)).toEqual(['hello', 'reply-blob']);
    expect((await callPro('GET', { query: `?shareId=${D1}`, token: B })).body.items).toEqual([]);                  // B never sees A's thread nor the reply
    expect((await callShare({ id: D1, capability: C1, action: 'send', threadId: 'new-thread', encryptedContent: 'x' })).statusCode).toBe(404);   // sharer cannot create threads
    expect((await callShare({ id: D1, capability: C1, action: 'send', threadId: t.id, encryptedContent: 'x'.repeat(33 * 1024) })).statusCode).toBe(413);
    expect((await callShare({ id: D1, capability: C1, action: 'send', threadId: t.id, encryptedContent: '' })).statusCode).toBe(400);
    expect((await callShare({}, 'GET')).statusCode).toBe(405);
    store.dossiers.set(D1, { id: D1, expiresAt: new Date(Date.now() - 1), rightsSecretHash: hash(C1), shareTokenHash: hash('recipient-' + C1) });
    expect((await callShare({ id: D1, capability: C1, action: 'list' })).statusCode).toBe(410);
    expect((await callShare({ id: D1, capability: C1, action: 'send', threadId: t.id, encryptedContent: 'late' })).statusCode).toBe(410);
  });
});
