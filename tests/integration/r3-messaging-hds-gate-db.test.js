/**
 * R3 (24/11/2026) — appointment messaging under the capability gate, as Production enforces it (ADA_CAPABILITY_ENFORCEMENT=1), real PostgreSQL:
 *   - messaging.conversations listed, NO HDS attestation: a conversation is served only for a NOT_ESSMS structure (verified, active, no FINESS, reviewed
 *     kind) AND a service reviewed « ordinary »; an ESSMS (FINESS) structure, or an unreviewed service, answers 503 CAPABILITY_NOT_OPEN and is not listed;
 *   - attachments (messaging.attachments) stay closed without HDS: upload refused 503 before anything is written, download refused, the thread says
 *     attachmentsAllowed: false;
 *   - with a valid HDS attestation and both capabilities listed: every conversation is served and attachments are allowed.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('AUTH_SECRET', 'test-auth-secret-r3-messaging');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => { const c = new Map(); return { kv: { incr: async (k) => { c.set(k, (c.get(k) || 0) + 1); return c.get(k); }, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }; });

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const OK = `r3-ok-${TS}`, ESSMS = `r3-essms-${TS}`;
const SVC_OK = `r3-svc-ok-${TS}`, SVC_UNREVIEWED = `r3-svc-unrev-${TS}`, SVC_E = `r3-svc-e-${TS}`;
const APT_OK = `r3-apt-ok-${TS}`, APT_UNREV = `r3-apt-unrev-${TS}`, APT_E = `r3-apt-e-${TS}`;
const P_OK = { id: `r3-p-ok-${TS}`, email: `r3-pok-${TS}@example.test` }, P_E = { id: `r3-p-e-${TS}`, email: `r3-pe-${TS}@example.test` };
const C = { id: `r3-c-${TS}`, email: `r3-c-${TS}@example.test` };
const HDS = `HDS1:example-host:CERT-2026-0001:2099-12-31:${'a'.repeat(64)}`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });
const enforced = (extra = {}) => { vi.stubEnv('ADA_CAPABILITY_ENFORCEMENT', '1'); vi.stubEnv('ADA_CAPABILITIES_OPEN', 'messaging.conversations'); vi.stubEnv('ADA_HDS_CERTIFIED_HOSTING', ''); for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v); };

describe.skipIf(!hasDatabase)('R3 messaging HDS gate (real DB)', () => {
  let db, auth, ua, citizenH, proH, proTabH, secureH, policy;
  const conv = {};
  const cit = () => ua.buildUserSessionCookie(ua.signUserSessionToken({ userId: C.id, email: C.email })).split(';')[0];
  const pro = (u, sid) => `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: sid, role: 'STRUCTURE_ADMIN' })}`;
  const callC = async (method, path, body) => { const r = mk(); await citizenH({ method, url: `/api/messages${path}`, query: {}, body, headers: { host: 'x', cookie: cit() } }, r); return r; };
  const callP = async (method, path, u, sid, body) => { const r = mk(); await proH({ method, url: `/api/pro/messages/conversations${path}`, query: {}, body, headers: { host: 'x', authorization: pro(u, sid) } }, r); return r; };
  const callTab = async (method, apt, u, sid, body) => { const r = mk(); await proTabH({ method, url: `/api/pro/messages?appointmentId=${apt}`, query: { appointmentId: apt }, body, headers: { host: 'x', authorization: pro(u, sid) } }, r); return r; };
  const callS = async (shareId, u, sid) => { const r = mk(); await secureH({ method: 'GET', url: `/api/secure-messages?shareId=${encodeURIComponent(shareId)}`, query: { shareId }, body: undefined, headers: { host: 'x', authorization: pro(u, sid) } }, r); return r; };
  const count = async (cid) => Number((await db.execute(sql`SELECT COUNT(*)::int AS n FROM "RdvConversationMessage" WHERE "conversationId" = ${cid}`)).rows[0].n);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); const schema = await import('../../src/db/schema.js');
    auth = await import('../../api/_utils/auth.js'); ua = await import('../../api/_utils/user-auth.js'); policy = await import('../../api/_services/messaging-policy.js');
    ({ default: citizenH } = await import('../../api/_handlers/messages.js')); ({ default: proH } = await import('../../api/_handlers/pro/messages-conversations.js'));
    ({ default: proTabH } = await import('../../api/_handlers/pro/messages.js')); ({ default: secureH } = await import('../../api/_handlers/secure-messages.js'));
    const review = (svc) => JSON.stringify({ serviceSensitivity: { v: 1, services: { [svc]: { value: 'ordinary', reviewedAt: '2026-11-20T10:00:00.000Z', reviewedBy: 'admin@example.test', reason: 'test' } } } });
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, settings_json, "updatedAt", "createdAt")
      VALUES (${OK}, 'Centre social R3', ${'r3-ok-' + TS}, 'centre social', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', ${review(SVC_OK)}::jsonb, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, numero_finess, settings_json, "updatedAt", "createdAt")
      VALUES (${ESSMS}, 'Etablissement R3', ${'r3-e-' + TS}, 'association', '2 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', '670000000', ${review(SVC_E)}::jsonb, NOW(), NOW())`);
    await db.insert(schema.ProUser).values([{ id: P_OK.id, email: P_OK.email, password_hash: 'x', structureId: OK, role: 'STRUCTURE_ADMIN', status: 'active' }, { id: P_E.id, email: P_E.email, password_hash: 'x', structureId: ESSMS, role: 'STRUCTURE_ADMIN', status: 'active' }]);
    await db.insert(schema.CitizenUser).values({ id: C.id, email: C.email, passwordHash: 'x', emailVerifiedAt: new Date() });
    const svc = (id, sid) => ({ id, structureId: sid, name: 'Accompagnement', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    await db.insert(schema.ProRdvService).values([svc(SVC_OK, OK), svc(SVC_UNREVIEWED, OK), svc(SVC_E, ESSMS)]);
    const t = (d) => new Date(Date.now() + d * 864e5);
    const apt = (id, sid, serviceId, d) => ({ id, structureId: sid, serviceId, startAt: t(d), endAt: t(d), status: 'confirmed', beneficiaryName: 'P', citizenUserId: C.id });
    await db.insert(schema.ProAppointment).values([apt(APT_OK, OK, SVC_OK, 3), apt(APT_UNREV, OK, SVC_UNREVIEWED, 4), apt(APT_E, ESSMS, SVC_E, 5)]);
    // the conversations exist (created in the LAB, enforcement off) — the question is what an enforced deployment serves
    for (const [k, a] of [['ok', APT_OK], ['unrev', APT_UNREV], ['e', APT_E]]) { const r = await callC('POST', `/from-appointment/${a}`); expect(r.statusCode).toBe(200); conv[k] = r.body.conversationId; }
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('AUTH_SECRET', 'test-auth-secret-r3-messaging'); });
  afterAll(async () => {
    if (!db) return;
    const sids = sql`(${OK}, ${ESSMS})`;
    await db.execute(sql`DELETE FROM "RdvNotificationLog" WHERE "conversationId" IN (SELECT id FROM "RdvConversation" WHERE "structureId" IN ${sids})`);
    await db.execute(sql`DELETE FROM "RdvConversationMessage" WHERE "conversationId" IN (SELECT id FROM "RdvConversation" WHERE "structureId" IN ${sids})`);
    await db.execute(sql`DELETE FROM "ContentReport" WHERE "contentType" = 'STRUCTURE' AND "contentId" IN ${sids}`);
    await db.execute(sql`DELETE FROM "RdvConversation" WHERE "structureId" IN ${sids}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" IN ${sids}`); await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" IN ${sids}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${C.id}`); await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${P_OK.id}, ${P_E.id})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN ${sids}`);
  });

  it('the decisions: NOT_ESSMS + ordinary service only, without HDS', async () => {
    enforced();
    const d = await policy.conversationDecisions([APT_OK, APT_UNREV, APT_E, 'unknown-apt']);
    expect(d.get(APT_OK)).toEqual({ open: true, reason: null });
    expect(d.get(APT_UNREV)).toEqual({ open: false, reason: 'HDS_REQUIRED:SERVICE_NOT_REVIEWED_ORDINARY' });
    expect(d.get(APT_E)).toEqual({ open: false, reason: 'HDS_REQUIRED:FINESS_REGISTERED' });
    expect(d.get('unknown-apt').open).toBe(false);
  });

  it('citizen: only the served conversation is listed; the others answer 503 CAPABILITY_NOT_OPEN; no file without HDS', async () => {
    enforced();
    const list = await callC('GET', '/conversations');
    expect(list.statusCode).toBe(200); expect(list.body.items.map((i) => i.id)).toEqual([conv.ok]);
    for (const k of ['unrev', 'e']) {
      const r = await callC('GET', `/conversations/${conv[k]}`);
      expect(r.statusCode, k).toBe(503); expect(r.body).toMatchObject({ code: 'CAPABILITY_NOT_OPEN', capability: 'messaging.conversations' });
      expect((await callC('POST', `/conversations/${conv[k]}`, { body: 'Bonjour' })).statusCode, k).toBe(503);
    }
    expect((await callC('POST', `/from-appointment/${APT_E}`)).statusCode).toBe(503);
    const thread = await callC('GET', `/conversations/${conv.ok}`);
    expect(thread.statusCode).toBe(200); expect(thread.body.item.attachmentsAllowed).toBe(false);
    const before = await count(conv.ok);
    const file = await callC('POST', `/conversations/${conv.ok}`, { body: 'avec fichier', attachment: { filename: 'a.png', mimeType: 'image/png', contentBase64: PNG } });
    expect(file.statusCode).toBe(503); expect(file.body.capability).toBe('messaging.attachments');
    expect(await count(conv.ok)).toBe(before);   // nothing written
    expect((await callC('GET', `/conversations/${conv.ok}/attachments/any-id`)).statusCode).toBe(503);
    expect((await callC('POST', `/conversations/${conv.ok}`, { body: 'Bonjour, une question sur mon rendez-vous.' })).statusCode).toBe(201);
    expect(await count(conv.ok)).toBe(before + 1);
  });

  it('pro: the ESSMS structure sees no conversation and its appointment tab is closed; the NOT_ESSMS one works without files', async () => {
    enforced();
    expect((await callP('GET', '', P_E, ESSMS)).body.items).toEqual([]);
    expect((await callP('GET', `/${conv.e}`, P_E, ESSMS)).statusCode).toBe(503);
    expect((await callTab('GET', APT_E, P_E, ESSMS)).statusCode).toBe(503);
    expect((await callTab('POST', APT_E, P_E, ESSMS, { content: 'Bonjour' })).statusCode).toBe(503);
    const okList = await callP('GET', '', P_OK, OK);
    expect(okList.body.items.map((i) => i.id)).toEqual([conv.ok]);   // the unreviewed service's conversation is not listed
    const t = await callP('GET', `/${conv.ok}`, P_OK, OK); expect(t.statusCode).toBe(200); expect(t.body.item.attachmentsAllowed).toBe(false);
    const before = await count(conv.ok);
    expect((await callP('POST', `/${conv.ok}`, P_OK, OK, { body: 'fichier', attachment: { filename: 'a.png', mimeType: 'image/png', contentBase64: PNG } })).statusCode).toBe(503);
    expect(await count(conv.ok)).toBe(before);
    expect((await callP('POST', `/${conv.ok}`, P_OK, OK, { body: 'Réponse de la structure.' })).statusCode).toBe(201);
    expect((await callTab('GET', APT_OK, P_OK, OK)).statusCode).toBe(200);
  });

  it('« Signaler » in a thread: one ContentReport row (STRUCTURE / AUTRE, fixed description, no text, no e-mail); only the other party\'s message; a closed conversation refuses', async () => {
    enforced();
    const msgs = (await db.execute(sql`SELECT id, "senderType" FROM "RdvConversationMessage" WHERE "conversationId" = ${conv.ok} ORDER BY "createdAt"`)).rows;
    const fromUser = msgs.find((m) => m.senderType === 'USER').id; const fromPro = msgs.find((m) => m.senderType === 'PRO').id;
    const reports = async () => (await db.execute(sql`SELECT "contentType", "contentId", reason, message, "reporterEmail" FROM "ContentReport" WHERE "contentId" = ${OK} ORDER BY "createdAt"`)).rows;
    expect((await callC('POST', `/conversations/${conv.ok}/report`, { messageId: fromUser, category: 'SPAM' })).body.error).toBe('OWN_MESSAGE');
    expect((await callC('POST', `/conversations/${conv.ok}/report`, { messageId: fromPro, category: 'free text' })).statusCode).toBe(400);
    const r = await callC('POST', `/conversations/${conv.ok}/report`, { messageId: fromPro, category: 'ABUSIVE' });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    const p = await callP('POST', `/${conv.ok}/report`, P_OK, OK, { messageId: fromUser, category: 'NOT_RELATED' });
    expect(p.statusCode, JSON.stringify(p.body)).toBe(201);
    const rows = await reports();
    expect(rows).toHaveLength(2);
    for (const row of rows) { expect(row).toMatchObject({ contentType: 'STRUCTURE', contentId: OK, reason: 'AUTRE', reporterEmail: null }); expect(row.message).not.toMatch(/Bonjour|Réponse/); }
    expect(rows[0].message).toContain(`conversation : ${conv.ok}`);
    expect((await callC('POST', `/conversations/${conv.e}/report`, { messageId: fromPro, category: 'SPAM' })).statusCode).toBe(503);   // not served here
    expect((await callP('POST', `/${conv.ok}/report`, P_E, ESSMS, { messageId: fromUser, category: 'SPAM' })).statusCode).toBe(404);   // another structure
    expect(await reports()).toHaveLength(2);
  });

  it('legacy secure-messages: the same decision for an appointment thread; an unknown id (or a dossier id while dossiers are closed) answers 404', async () => {
    enforced();
    expect((await callS(conv.ok, P_OK, OK)).statusCode).toBe(200);
    expect((await callS(conv.e, P_E, ESSMS)).statusCode).toBe(503);
    expect((await callS(`unknown-${TS}`, P_OK, OK)).statusCode).toBe(404);
  });
  it('with a valid HDS attestation every conversation is served and files are allowed once messaging.attachments is listed', async () => {
    enforced({ ADA_HDS_CERTIFIED_HOSTING: HDS });
    expect((await callC('GET', `/conversations/${conv.e}`)).statusCode).toBe(200);
    expect((await callC('GET', `/conversations/${conv.e}`)).body.item.attachmentsAllowed).toBe(false);   // not listed yet
    enforced({ ADA_HDS_CERTIFIED_HOSTING: HDS, ADA_CAPABILITIES_OPEN: 'messaging.conversations,messaging.attachments' });
    expect((await callC('GET', '/conversations')).body.items).toHaveLength(3);
    expect((await callC('GET', `/conversations/${conv.e}`)).body.item.attachmentsAllowed).toBe(true);
    expect((await callP('GET', `/${conv.e}`, P_E, ESSMS)).statusCode).toBe(200);
  });
});
